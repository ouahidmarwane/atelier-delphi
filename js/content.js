// Contenu de l'atelier : scénario, départements, questions et catalogue d'analyse.
// Tout le texte affiché à la classe se modifie ici.

export const SCENARIO = {
  company: 'MecaParts Maroc',
  place: 'Zone industrielle de Kénitra · entreprise fictive',
  lead: 'MecaParts Maroc fabrique des pièces moteur en aluminium. Un constructeur automobile lui commande 200 000 pièces par an pendant 3 ans.',
  stake: 'Pour livrer, elle doit lancer une nouvelle ligne de production dans 3 mois. La date est ferme, avec une pénalité de 2 % par semaine de retard.',
  facts: [
    { figure: '4', unit: 'machines', text: 'commandées à un fournisseur étranger, livraison annoncée en 8 semaines' },
    { figure: '30', unit: 'opérateurs', text: 'à recruter et à former' },
    { figure: '1', unit: 'fournisseur', text: 'de matière première qualifié, et un seul' },
    { figure: '85 %', unit: 'de capacité', text: 'déjà utilisés dans l’usine actuelle' },
    { figure: '< 50', unit: 'ppm', text: 'pièces défectueuses par million exigées, audit client avant démarrage' },
  ],
  // Frise de 12 semaines affichée sous le scénario
  timeline: [
    { week: 0, label: 'Commande reçue' },
    { week: 8, label: 'Machines livrées' },
    { week: 12, label: 'Démarrage série' },
  ],
};

export const DEPARTMENTS = [
  { id: 'prod', name: 'Production', color: '#3d6fc9' },
  { id: 'supply', name: 'Supply chain / Achats', color: '#2e9a76' },
  { id: 'maint', name: 'Maintenance', color: '#b7832a' },
  { id: 'qual', name: 'Qualité', color: '#7c5cc4' },
  { id: 'rh', name: 'Ressources humaines', color: '#c24d78' },
];
export const deptById = Object.fromEntries(DEPARTMENTS.map((d) => [d.id, d]));

// Étapes de la procédure Delphi du cours, affichées en haut de l'écran projecteur
export const STEPS = [
  { id: 'prep', label: 'Préparation' },
  { id: 'r1', label: 'Tour 1' },
  { id: 'a1', label: 'Analyse' },
  { id: 'r2', label: 'Tour 2' },
  { id: 'a2', label: 'Analyse' },
  { id: 'r3', label: 'Tour 3+' },
  { id: 'a3', label: 'Consensus' },
  { id: 'eval', label: 'Évaluation' },
  { id: 'end', label: 'Résultat' },
];

export const ROUND1_QUESTIONS = [
  {
    key: 'q1',
    title: 'Quels risques ce projet fait-il peser sur votre département ?',
    hint: 'Un risque par ligne',
  },
  {
    key: 'q2',
    title: 'Quelles sont les causes de ces risques ?',
    hint: 'Une cause par ligne',
  },
  {
    key: 'q3',
    title: 'Quelles conséquences pour l’entreprise si ces risques se réalisent ?',
    hint: 'Une conséquence par ligne',
  },
  {
    key: 'q4',
    title: 'Que perd l’entreprise si le projet échoue ?',
    hint: 'Pensez aux opportunités : le client, le marché, la réputation',
  },
];

export const SCALES = {
  p: {
    label: 'Fréquence',
    steps: ['Très rare', 'Rare', 'Occasionnelle', 'Fréquente', 'Très fréquente'],
  },
  i: {
    label: 'Gravité',
    steps: ['Négligeable', 'Mineure', 'Modérée', 'Majeure', 'Critique'],
  },
};

export const RULES = {
  // Consensus : au moins 70 % des réponses à ±1 de la médiane, en fréquence et en gravité
  consensusShare: 0.7,
  // Au tour 3, un écart de 2 points ou plus avec la médiane exige une justification
  justifyGap: 2,
  defaultDuration: 180,
  ratingDuration: 90,
  interlude: 10,
  maxRisks: 8,
};

// Grille de notation du cours : la priorité dépend de la case fréquence × gravité
export function priorityOf(f, g) {
  const F = Math.round(f ?? 0);
  const G = Math.round(g ?? 0);
  if (G >= 4) return 'p1';
  if (G === 3) return F >= 4 ? 'p1' : 'p2';
  return F >= 3 ? 'p2' : 'p3';
}

// Critères d'évaluation : chaque priorité de la grille correspond à une décision
export const EVAL_CRITERIA = [
  { id: 'p1', label: 'Priorité 1', action: 'Traiter en priorité', zone: 'Gravité 4 ou 5, ou gravité 3 avec fréquence 4 ou 5', text: 'Plan d’action immédiat avec un responsable nommé' },
  { id: 'p2', label: 'Priorité 2', action: 'À traiter', zone: 'Gravité 3 avec fréquence 1 à 3, ou gravité 1 ou 2 avec fréquence 3 à 5', text: 'Mesures planifiées avant le démarrage et suivi régulier' },
  { id: 'p3', label: 'Priorité 3', action: 'À surveiller', zone: 'Gravité 1 ou 2 avec fréquence 1 ou 2', text: 'On garde les moyens de maîtrise existants' },
];
export const decisionById = Object.fromEntries(EVAL_CRITERIA.map((c) => [c.id, c]));
export function autoDecision(x) {
  return decisionById[priorityOf(x?.p?.median, x?.i?.median)];
}

export function levelOf(crit) {
  if (crit >= 15) return { id: 'crit', label: 'Critique' };
  if (crit >= 10) return { id: 'high', label: 'Élevé' };
  if (crit >= 5) return { id: 'mid', label: 'Moyen' };
  return { id: 'low', label: 'Faible' };
}

// Catalogue de thèmes : sert à regrouper les réponses libres et à repérer les doublons.
// Une entrée texte = un mot qui commence ainsi ; un tableau = tous ces mots doivent être présents.
export const THEMES = [
  { id: 'machines', label: 'Retard de livraison ou d’installation des machines',
    kw: [['machin', 'retard'], ['machin', 'livr'], ['machin', 'arriv'], ['equipement', 'retard'], ['equipement', 'livr'], 'install', 'douane', 'mise en service', 'fournisseur etranger', 'import'] },
  { id: 'demarrage', label: 'Retard du démarrage de la ligne',
    kw: ['demarrage', 'lancement', ['ligne', 'retard'], ['delai', 'respect'], ['delai', 'court'], ['delai', 'serre'], '3 mois', 'trois mois', 'planning serre'] },
  { id: 'penalites', label: 'Pénalités de retard',
    kw: ['penalit', 'amende', '2 %', '2%'] },
  { id: 'fournisseur', label: 'Dépendance au fournisseur unique de matière',
    kw: ['fournisseur unique', 'seul fournisseur', 'un fournisseur', 'monofournisseur', 'mono fournisseur', 'dependance', ['matiere', 'rupture'], ['matiere', 'manque'], ['aluminium', 'manque'], ['approvision', 'retard'], 'approvisionnement', ['faute', 'matiere']] },
  { id: 'stock', label: 'Rupture ou mauvaise gestion des stocks',
    kw: ['stock', 'inventaire', 'prevision'] },
  { id: 'cout_matiere', label: 'Hausse du coût des matières premières',
    kw: [['prix', 'matiere'], ['cout', 'matiere'], ['prix', 'aluminium'], ['cout', 'aluminium'], 'inflation', ['augment', 'prix'], ['variation', 'prix'], ['prix', 'fournisseur']] },
  { id: 'capacite', label: 'Capacité de l’usine déjà saturée',
    kw: ['capacite', 'saturation', 'sature', 'surcharge', '85', 'manque de place', 'manque d espace', 'goulot', 'rendement', 'productivit'] },
  { id: 'pannes', label: 'Pannes et arrêts des machines',
    kw: ['panne', 'arret', 'defaillance', 'usure', 'casse', 'dysfonctionn'] },
  { id: 'pieces', label: 'Manque de pièces de rechange',
    kw: ['rechange', 'pieces detachees', 'piece detachee'] },
  { id: 'maint_prev', label: 'Maintenance préventive insuffisante',
    kw: ['preventi', 'plan de maintenance', ['maintenance', 'insuffis'], ['maintenance', 'manque']] },
  { id: 'reglage', label: 'Mauvais réglage des équipements',
    kw: ['reglage', 'regle', 'parametr', 'calibr', 'etalonn'] },
  { id: 'qualite', label: 'Pièces non conformes et défauts qualité',
    kw: ['non conform', 'nonconform', 'defaut', 'defectu', 'ppm', 'rebut', 'retouche', 'qualite', 'reclamation', 'controle', 'cahier des charges', 'exigence'] },
  { id: 'audit', label: 'Échec de l’audit du constructeur',
    kw: ['audit', 'certification', 'homologation'] },
  { id: 'recrutement', label: 'Difficulté à recruter 30 opérateurs',
    kw: ['recrut', 'embauch', 'main d oeuvre', 'penurie', ['manque', 'personnel'], ['manque', 'operateur'], ['manque', 'technicien'], '30 operateurs', 'effectif'] },
  { id: 'formation', label: 'Formation insuffisante des opérateurs',
    kw: ['formation', 'former', 'forme', 'competence', 'inexperi', ['manque', 'qualifi'], 'peu qualifi', 'non qualifi', 'erreur de manipulation', 'erreurs de manipulation', 'erreur humaine', 'erreurs humaines'] },
  { id: 'absence', label: 'Absentéisme et départs du personnel',
    kw: ['absent', 'turnover', 'demission', 'rotation', 'greve', 'motivation', 'conditions de travail', 'climat social'] },
  { id: 'securite', label: 'Accidents du travail',
    kw: ['accident', 'securite', 'blessure'] },
  { id: 'budget', label: 'Dépassement de budget et tension de trésorerie',
    kw: ['budget', 'tresorerie', 'financ', 'rentabilit', ['cout', 'depass'], 'perte financiere', 'pertes financieres', 'marge', 'surcout'] },
  { id: 'planification', label: 'Planification et coordination défaillantes',
    kw: ['planif', 'programme', 'coordination', 'organisation', 'communication'] },
  { id: 'client', label: 'Perte du client et atteinte à l’image',
    kw: ['client', 'image', 'reputation', 'confiance', 'contrat', 'futures commandes', 'commandes futures', 'concurren', 'marche'] },
];
export const themeById = Object.fromEntries(THEMES.map((t) => [t.id, t]));

// Réponses des participants fictifs du mode répétition, par département et par question
export const BOT_LINES = {
  prod: {
    q1: ['Retard du démarrage de la ligne', 'Arrêt imprévu de la production', 'Capacité de l’usine déjà saturée à 85 %', 'Non-respect du programme de production', 'Déséquilibre de la ligne au démarrage'],
    q2: ['Machines livrées en retard', 'Planification trop serrée sur 3 mois', 'Opérateurs pas encore formés', 'Mauvaise organisation des postes'],
    q3: ['Pénalités de 2 % par semaine', 'Retard de livraison au client', 'Baisse de productivité'],
    q4: ['Le contrat sur 3 ans', 'La confiance du constructeur', 'Des futures commandes'],
  },
  supply: {
    q1: ['Rupture de matière première', 'Dépendance à un seul fournisseur', 'Hausse du prix de l’aluminium', 'Retard de livraison des machines par le fournisseur étranger', 'Erreur de gestion des stocks'],
    q2: ['Un seul fournisseur qualifié', 'Délais de douane', 'Mauvaise prévision des besoins', 'Variation des prix fournisseurs'],
    q3: ['Arrêt de la ligne faute de matière', 'Surcoût d’achat', 'Pénalités de retard'],
    q4: ['Part de marché face aux concurrents', 'La réputation auprès des constructeurs'],
  },
  maint: {
    q1: ['Pannes des nouvelles machines', 'Retard d’installation des machines', 'Manque de pièces de rechange', 'Maintenance préventive insuffisante', 'Mauvais réglage des équipements'],
    q2: ['Techniciens pas formés sur les nouvelles machines', 'Pas de plan de maintenance préventive', 'Usure des machines existantes à 85 %'],
    q3: ['Arrêt de production', 'Défauts de fabrication', 'Prolongation des pannes'],
    q4: ['Le contrat et l’image de l’entreprise'],
  },
  qual: {
    q1: ['Pièces non conformes au démarrage', 'Échec de l’audit du constructeur', 'Taux de défaut au-dessus de 50 ppm', 'Absence de procédures de contrôle'],
    q2: ['Mauvais réglage des machines', 'Contrôle qualité insuffisant', 'Opérateurs inexpérimentés', 'Mauvaise interprétation du cahier des charges'],
    q3: ['Rebuts et retouches', 'Réclamations client', 'Livraison de pièces défectueuses'],
    q4: ['La certification et la confiance du client', 'Les futures commandes'],
  },
  rh: {
    q1: ['Difficulté à recruter 30 opérateurs', 'Formation insuffisante des opérateurs', 'Turnover élevé', 'Absentéisme', 'Accidents du travail des nouveaux'],
    q2: ['Pénurie de main d’oeuvre qualifiée à Kénitra', 'Temps de formation limité', 'Conditions de travail en équipes'],
    q3: ['Erreurs de manipulation', 'Retard du démarrage', 'Perte de compétences'],
    q4: ['L’image de l’entreprise comme employeur', 'Le contrat avec le constructeur'],
  },
};

export const BOT_NAMES = [
  'Yasmine', 'Hamza', 'Salma', 'Mehdi', 'Imane', 'Othmane', 'Kenza', 'Ayoub', 'Nour', 'Ilyas',
  'Sara', 'Anas', 'Hiba', 'Zakaria', 'Rim', 'Adam', 'Douae', 'Yassine', 'Malak', 'Reda',
  'Chaimae', 'Amine', 'Ghita', 'Soufiane', 'Lina', 'Bilal', 'Aya', 'Walid',
];

export const BOT_MEASURES = {
  machines: 'Suivi hebdomadaire du fournisseur et pénalités contractuelles',
  demarrage: 'Démarrage progressif avec une équipe pilote',
  penalites: 'Négocier un plan de montée en cadence avec le constructeur',
  fournisseur: 'Qualifier un second fournisseur d’aluminium',
  stock: 'Stock de sécurité de 3 semaines',
  cout_matiere: 'Contrat à prix fixe sur 12 mois',
  capacite: 'Ajouter une équipe de nuit',
  pannes: 'Contrat de maintenance avec le fabricant des machines',
  pieces: 'Kit de pièces critiques commandé avec les machines',
  maint_prev: 'Plan de maintenance préventive dès l’installation',
  reglage: 'Fiches de réglage validées par la qualité',
  qualite: 'Contrôle à 100 % pendant le premier mois',
  audit: 'Audit blanc 3 semaines avant l’audit client',
  recrutement: 'Partenariat avec l’OFPPT et une agence d’intérim',
  formation: 'Formation sur les machines chez le fournisseur',
  absence: 'Primes d’assiduité pendant le lancement',
  securite: 'Accueil sécurité obligatoire pour chaque nouvel opérateur',
  budget: 'Réserve budgétaire de 10 %',
  planification: 'Réunion de pilotage hebdomadaire',
  client: 'Point d’avancement mensuel avec le constructeur',
};
