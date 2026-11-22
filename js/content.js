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
export const roundName = (r) => (r === 1 ? 'Identification' : r === 2 ? 'Analyse' : 'Convergence');

export const STEPS = [
  { id: 'prep', label: 'Préparation' },
  { id: 'r1', label: 'Tour 1 · Identification' },
  { id: 'a1', label: 'Consolidation' },
  { id: 'r2', label: 'Tour 2 · Analyse' },
  { id: 'a2', label: 'Synthèse' },
  { id: 'r3', label: 'Tour 3 · Convergence' },
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
    title: 'Quelles mesures proposez-vous pour réduire ces risques ?',
    hint: 'Facultatif · une mesure par ligne',
    optional: true,
  },
];

export const SCALES = {
  p: {
    label: 'Probabilité',
    steps: ['Très improbable', 'Peu probable', 'Possible', 'Probable', 'Quasi certain'],
  },
  i: {
    label: 'Gravité',
    steps: ['Négligeable', 'Mineure', 'Modérée', 'Majeure', 'Critique'],
  },
};

export const RULES = {
  // Consensus : au moins 70 % des réponses à ±1 de la médiane, en probabilité et en gravité
  consensusShare: 0.7,
  // Au tour 3, un écart de 2 points ou plus avec la médiane exige une justification
  justifyGap: 2,
  defaultDuration: 180,
  ratingDuration: 90,
  interlude: 10,
  maxRisks: 8,
  // Réponses stabilisées : au plus 20 % des participants changent leur note et la médiane bouge d'un demi-point au plus
  stableChange: 0.2,
};

// Grille de notation du cours : la priorité dépend de la case probabilité × gravité
export function priorityOf(f, g) {
  const F = Math.round(f ?? 0);
  const G = Math.round(g ?? 0);
  if (G >= 4) return 'p1';
  if (G === 3) return F >= 4 ? 'p1' : 'p2';
  return F >= 3 ? 'p2' : 'p3';
}

// Critères d'évaluation : chaque priorité de la grille correspond à une décision
export const EVAL_CRITERIA = [
  { id: 'p1', label: 'Priorité 1', action: 'Traiter en priorité', zone: 'Gravité 4 ou 5, ou gravité 3 avec probabilité 4 ou 5', text: 'Plan d’action immédiat avec un responsable nommé' },
  { id: 'p2', label: 'Priorité 2', action: 'À traiter', zone: 'Gravité 3 avec probabilité 1 à 3, ou gravité 1 ou 2 avec probabilité 3 à 5', text: 'Mesures planifiées avant le démarrage et suivi régulier' },
  { id: 'p3', label: 'Priorité 3', action: 'À surveiller', zone: 'Gravité 1 ou 2 avec probabilité 1 ou 2', text: 'On garde les moyens de maîtrise existants' },
];
export const decisionById = Object.fromEntries(EVAL_CRITERIA.map((c) => [c.id, c]));
// Principe de prudence : sans consensus, on évalue avec l'avis haut (3e quartile) plutôt qu'avec la médiane
export const isPrudent = (x) => !!(x && x.n && x.consensus === false);
export function autoDecision(x) {
  if (isPrudent(x)) return decisionById[priorityOf(Math.ceil(x.p.q3), Math.ceil(x.i.q3))];
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
    kw: [['machin', 'retard'], ['machin', 'livr'], ['machin', 'arriv'], ['machin', 'delai'], ['machin', 'attend'], ['equipement', 'retard'], ['equipement', 'livr'], ['equipement', 'arriv'], ['equipement', 'delai'],
      'install', 'douane', 'mise en service', 'mise en route', 'mise en place', 'fournisseur etranger', 'import', 'livraison tardive', 'conteneur', 'transport des machines', ['fournisseur', 'livre pas'], ['fournisseur', 'a temps']] },
  { id: 'demarrage', label: 'Retard du démarrage de la ligne',
    kw: ['demarrage', 'lancement', ['ligne', 'retard'], ['projet', 'retard'], ['delai', 'respect'], ['delai', 'court'], ['delai', 'serre'], ['delai', 'depass'], '3 mois', 'trois mois', 'planning serre', 'echeance', 'date limite', 'deadline', 'pas prete a temps', 'pas pret a temps'] },
  { id: 'penalites', label: 'Pénalités de retard',
    kw: ['penalit', 'amende', 'sanction', 'indemnit', 'dedommag', '2 %', '2%'] },
  { id: 'fournisseur', label: 'Dépendance au fournisseur unique de matière',
    kw: ['fournisseur unique', 'seul fournisseur', 'un fournisseur', 'monofournisseur', 'mono fournisseur', 'dependance', 'aluminium', 'matiere premiere', 'matieres premieres', 'faillite',
      ['matiere', 'rupture'], ['matiere', 'manque'], ['fournisseur', 'defaillan'], ['fournisseur', 'probleme'], ['fournisseur', 'retard'], ['approvision', 'retard'], 'approvisionnement', ['faute', 'matiere'], ['penurie', 'matiere']] },
  { id: 'stock', label: 'Rupture ou mauvaise gestion des stocks',
    kw: ['stock', 'inventaire', 'prevision', 'rupture', 'entrepot', 'magasin'] },
  { id: 'cout_matiere', label: 'Hausse du coût des matières premières',
    kw: [['prix', 'matiere'], ['cout', 'matiere'], ['prix', 'aluminium'], ['cout', 'aluminium'], 'inflation', ['augment', 'prix'], ['hausse', 'prix'], ['variation', 'prix'], ['prix', 'fournisseur'], 'flambee', 'taux de change', 'devise', ['matiere', 'cher']] },
  { id: 'capacite', label: 'Capacité de l’usine déjà saturée',
    kw: ['capacite', 'saturation', 'sature', 'surcharg', 'encombr', '85', 'manque de place', 'manque d espace', 'pas de place', 'plus de place', 'pas assez de place', 'goulot', 'rendement', 'productivit', 'cadence',
      ['usine', 'plein'], ['atelier', 'plein'], ['usine', 'petit'], ['espace', 'insuffis']] },
  { id: 'pannes', label: 'Pannes et arrêts des machines',
    kw: ['panne', 'arret', 'defaillan', 'usure', 'casse', 'dysfonction', 'avarie', 'incident technique', ['machin', 'bloqu'], ['machin', 'marche pas'], ['machin', 'fonctionne pas']] },
  { id: 'pieces', label: 'Manque de pièces de rechange',
    kw: ['rechange', 'pieces detachees', 'piece detachee', 'consommable'] },
  { id: 'maint_prev', label: 'Maintenance préventive insuffisante',
    kw: ['preventi', 'entretien', 'plan de maintenance', ['maintenance', 'insuffis'], ['maintenance', 'manque'], ['maintenance', 'retard'], ['maintenance', 'mauvais']] },
  { id: 'reglage', label: 'Mauvais réglage des équipements',
    kw: ['reglage', 'regle', 'parametr', 'calibr', 'etalonn', 'configur'] },
  { id: 'qualite', label: 'Pièces non conformes et défauts qualité',
    kw: ['non conform', 'nonconform', 'conformit', 'defaut', 'defectu', 'ppm', 'rebut', 'retouche', 'qualite', 'reclamation', 'controle', 'cahier des charges', 'exigence', 'tolerance', 'fiabilit',
      ['piece', 'mauvais'], ['piece', 'respect']] },
  { id: 'audit', label: 'Échec de l’audit du constructeur',
    kw: ['audit', 'certif', 'homolog', 'iatf', 'inspection', 'validation client', 'approbation'] },
  { id: 'recrutement', label: 'Difficulté à recruter 30 opérateurs',
    kw: ['recrut', 'embauch', 'main d oeuvre', 'penurie', 'sous effectif', 'effectif', 'candidat', 'interim', 'pas assez de personnel', '30 operateurs',
      ['manque', 'personnel'], ['manque', 'operateur'], ['manque', 'ouvrier'], ['manque', 'technicien'], ['ouvrier', 'trouv'], ['ouvrier', 'assez'], ['operateur', 'trouv'], ['operateur', 'assez'], ['personnel', 'trouv']] },
  { id: 'formation', label: 'Formation insuffisante des opérateurs',
    kw: ['formation', 'former', 'forme', 'competen', 'inexperi', 'novice', 'debutant', 'apprentissage', 'maitrise', 'savent pas', 'sait pas', 'nouvelles recrues', 'nouveaux employes', 'nouveaux operateurs',
      ['manque', 'qualifi'], 'peu qualifi', 'non qualifi', ['manque', 'experience'], ['nouveaux', 'savent'], 'erreur de manipulation', 'erreurs de manipulation', 'erreur humaine', 'erreurs humaines'] },
  { id: 'absence', label: 'Absentéisme et départs du personnel',
    kw: ['absent', 'absence', 'turnover', 'turn over', 'demission', 'rotation', 'greve', 'syndicat', 'motivation', 'moral', 'fatigue', 'stress', 'surmenage', 'conflit', 'conditions de travail', 'climat social', 'quittent', 'quitter l entreprise'] },
  { id: 'securite', label: 'Accidents du travail',
    kw: ['accident', 'securite', 'blessure', 'blesse', 'danger', 'incendie', 'chute'] },
  { id: 'budget', label: 'Dépassement de budget et tension de trésorerie',
    kw: ['budget', 'tresorerie', 'financ', 'rentabilit', 'surcout', 'marge', 'investissement', 'depense', 'dette', 'argent', ['cout', 'depass'], ['cout', 'eleve'], 'perte financiere', 'pertes financieres'] },
  { id: 'planification', label: 'Planification et coordination défaillantes',
    kw: ['planif', 'planning', 'programme', 'coordination', 'organisation', 'communication', 'mal organise', 'gestion de projet', 'priorit'] },
  { id: 'client', label: 'Perte du client et atteinte à l’image',
    kw: ['client', 'image', 'reputation', 'confiance', 'contrat', 'futures commandes', 'commandes futures', 'concurren', 'marche', 'marque', 'fidelit', 'satisfaction'] },
];
export const themeById = Object.fromEntries(THEMES.map((t) => [t.id, t]));

// Réponses des participants fictifs du mode répétition, par département et par question
export const BOT_LINES = {
  prod: {
    q1: ['Retard du démarrage de la ligne', 'Arrêt imprévu de la production', 'Capacité de l’usine déjà saturée à 85 %', 'Non-respect du programme de production', 'Déséquilibre de la ligne au démarrage'],
    q2: ['Machines livrées en retard', 'Planification trop serrée sur 3 mois', 'Opérateurs pas encore formés', 'Mauvaise organisation des postes'],
    q3: ['Pénalités de 2 % par semaine', 'Retard de livraison au client', 'Baisse de productivité'],
    q4: ['Démarrage progressif avec une équipe pilote', 'Ajouter une équipe de nuit pendant le lancement', 'Réunion de pilotage chaque semaine'],
  },
  supply: {
    q1: ['Rupture de matière première', 'Dépendance à un seul fournisseur', 'Hausse du prix de l’aluminium', 'Retard de livraison des machines par le fournisseur étranger', 'Erreur de gestion des stocks'],
    q2: ['Un seul fournisseur qualifié', 'Délais de douane', 'Mauvaise prévision des besoins', 'Variation des prix fournisseurs'],
    q3: ['Arrêt de la ligne faute de matière', 'Surcoût d’achat', 'Pénalités de retard'],
    q4: ['Qualifier un second fournisseur d’aluminium', 'Stock de sécurité de matière première', 'Suivi hebdomadaire du fournisseur de machines'],
  },
  maint: {
    q1: ['Pannes des nouvelles machines', 'Retard d’installation des machines', 'Manque de pièces de rechange', 'Maintenance préventive insuffisante', 'Mauvais réglage des équipements'],
    q2: ['Techniciens pas formés sur les nouvelles machines', 'Pas de plan de maintenance préventive', 'Usure des machines existantes à 85 %'],
    q3: ['Arrêt de production', 'Défauts de fabrication', 'Prolongation des pannes'],
    q4: ['Plan de maintenance préventive dès l’installation', 'Commander les pièces de rechange avec les machines', 'Former les techniciens chez le fabricant'],
  },
  qual: {
    q1: ['Pièces non conformes au démarrage', 'Échec de l’audit du constructeur', 'Taux de défaut trop élevé', 'Absence de procédures de contrôle'],
    q2: ['Mauvais réglage des machines', 'Contrôle qualité insuffisant', 'Opérateurs inexpérimentés', 'Mauvaise interprétation du cahier des charges'],
    q3: ['Rebuts et retouches', 'Réclamations client', 'Livraison de pièces défectueuses'],
    q4: ['Contrôle à 100 % pendant le premier mois', 'Audit blanc avant l’audit client', 'Fiches de réglage validées'],
  },
  rh: {
    q1: ['Difficulté à recruter 30 opérateurs', 'Formation insuffisante des opérateurs', 'Turnover élevé', 'Absentéisme', 'Accidents du travail des nouveaux'],
    q2: ['Pénurie de main d’oeuvre qualifiée à Kénitra', 'Temps de formation limité', 'Conditions de travail en équipes'],
    q3: ['Erreurs de manipulation', 'Retard du démarrage', 'Perte de compétences'],
    q4: ['Partenariat avec l’OFPPT pour le recrutement', 'Formation des opérateurs sur les nouvelles machines', 'Prime d’assiduité pendant le lancement'],
  },
};

export const BOT_NAMES = [
  'Yasmine', 'Hamza', 'Salma', 'Mehdi', 'Imane', 'Othmane', 'Kenza', 'Ayoub', 'Nour', 'Ilyas',
  'Sara', 'Anas', 'Hiba', 'Zakaria', 'Rim', 'Adam', 'Douae', 'Yassine', 'Malak', 'Reda',
  'Chaimae', 'Amine', 'Ghita', 'Soufiane', 'Lina', 'Bilal', 'Aya', 'Walid',
];

// Arguments des participants fictifs quand leur note s'écarte du groupe
export const BOT_ARGS = {
  up: ['Le délai de 3 mois ne laisse aucune marge', 'Nous avons déjà vécu ce problème sur l’ancienne ligne', 'Une seule défaillance bloque toute la production', 'Le constructeur ne tolérera aucun retard'],
  down: ['Un plan de secours existe déjà dans notre service', 'Le fournisseur a toujours tenu ses délais', 'Ce risque est rare dans notre usine', 'Les procédures actuelles couvrent déjà ce cas'],
};

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
