// Regroupe les réponses du tour 1 par sens avec Gemini (offre gratuite de Google).
// La clé est un secret Supabase : GEMINI_API_KEY. GEMINI_MODEL est facultatif.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Line = { id: string; q: string; text: string };
type Payload = { questions: { key: string; title: string }[]; lines: Line[]; themes: { id: string; label: string }[] };

let modelCache: string[] | null = null;

function version(name: string) {
  const m = name.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

// Choisit automatiquement les modèles Flash disponibles pour cette clé, du plus récent au plus ancien
async function models(key: string): Promise<string[]> {
  const forced = Deno.env.get("GEMINI_MODEL");
  if (forced) return [forced];
  if (modelCache) return modelCache;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${key}`);
  const data = await res.json();
  const names: string[] = (data.models || [])
    .filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m: any) => String(m.name).replace("models/", ""))
    .filter((n: string) => n.includes("flash") && !/(image|tts|live|audio|embedding|vision|thinking|exp)/.test(n));
  names.sort((a, b) => {
    const pa = a.includes("preview") ? 1 : 0;
    const pb = b.includes("preview") ? 1 : 0;
    if (pa !== pb) return pa - pb;
    return version(b) - version(a) || (a.includes("lite") ? 1 : 0) - (b.includes("lite") ? 1 : 0);
  });
  modelCache = names.length ? names.slice(0, 4) : ["gemini-flash-latest", "gemini-flash-lite-latest"];
  return modelCache;
}

const schema = {
  type: "OBJECT",
  properties: {
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          q: { type: "STRING" },
          groups: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                label: { type: "STRING" },
                theme: { type: "STRING" },
                ids: { type: "ARRAY", items: { type: "STRING" } },
              },
              required: ["label", "ids"],
            },
          },
        },
        required: ["q", "groups"],
      },
    },
  },
  required: ["questions"],
};

function prompt(p: Payload) {
  const qs = p.questions.map((q) => `- ${q.key} : ${q.title}`).join("\n");
  const themes = p.themes.map((t) => `- ${t.id} : ${t.label}`).join("\n");
  const lines = p.lines.map((l) => `${l.id} | ${l.q} | ${l.text}`).join("\n");
  return `Tu analyses les réponses d'étudiants à un atelier Delphi de gestion des risques.
Scénario : MecaParts Maroc lance en 3 mois une nouvelle ligne de production de pièces moteur en aluminium pour un constructeur automobile (machines importées livrées en 8 semaines, 30 opérateurs à recruter et former, un seul fournisseur de matière, usine déjà à 85 % de capacité, exigence de moins de 50 ppm et audit client, pénalité de 2 % par semaine de retard).

Questions :
${qs}

Catalogue de risques connus :
${themes}

Réponses (id | question | texte) :
${lines}

Consignes :
1. Pour chaque question, regroupe les réponses qui expriment la même idée, même si la formulation, l'orthographe ou les fautes de frappe diffèrent.
2. Chaque id appartient à un seul groupe, dans la question où il est posé. N'oublie aucun id et n'invente aucun id.
3. Pour la question q1 (les risques), si un groupe correspond à un risque du catalogue, mets son identifiant dans "theme" et reprends exactement son intitulé dans "label". Sinon laisse "theme" vide et écris un intitulé court de risque, en français, commençant par une majuscule, sans point final.
4. Pour les autres questions, laisse "theme" vide et donne à chaque groupe un intitulé court et précis en français.
5. Ne fusionne pas deux idées différentes juste parce qu'elles concernent le même service.
6. Une réponse vide de sens ou hors sujet forme un groupe "Hors sujet".`;
}

async function callGemini(key: string, model: string, p: Payload) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt(p) }] }],
      generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseSchema: schema },
    }),
  });
  if (!res.ok) throw new Error(`${model} ${res.status} ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((x: any) => x.text || "").join("") || "";
  return JSON.parse(text);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const key = Deno.env.get("GEMINI_API_KEY");
    if (!key) return json({ error: "GEMINI_API_KEY manquante dans les secrets Supabase" }, 500);
    const p = (await req.json()) as Payload;
    if (!p?.lines?.length) return json({ questions: [] });
    p.lines = p.lines.slice(0, 800).map((l) => ({ id: String(l.id), q: String(l.q), text: String(l.text).slice(0, 200) }));
    const valid = new Set(p.lines.map((l) => l.id));
    const qOf = Object.fromEntries(p.lines.map((l) => [l.id, l.q]));
    const errors: string[] = [];
    for (const model of await models(key)) {
      try {
        const out = await callGemini(key, model, p);
        // Nettoyage : ids existants uniquement, chacun une seule fois et dans sa propre question
        const seen = new Set<string>();
        const questions = (out.questions || []).map((q: any) => ({
          q: String(q.q),
          groups: (q.groups || [])
            .map((g: any) => ({
              label: String(g.label || "").trim(),
              theme: String(g.theme || "").trim(),
              ids: (g.ids || []).map(String).filter((id: string) => valid.has(id) && qOf[id] === q.q && !seen.has(id) && seen.add(id)),
            }))
            .filter((g: any) => g.label && g.ids.length),
        }));
        return json({ model, questions });
      } catch (e) {
        errors.push(String(e));
      }
    }
    return json({ error: "Aucun modèle Gemini n'a répondu", details: errors }, 502);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
