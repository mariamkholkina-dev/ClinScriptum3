/**
 * Generates regex patterns for deterministic fact extraction
 * based on existing labels and value types in the fact registry.
 *
 * Run: npx tsx scripts/generate-fact-patterns.ts
 * Outputs SQL UPDATE statements to add patterns to rule configs.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface FactConfig {
  type: string;
  category: string;
  factKey: string;
  valueType: string;
  labelsRu: string[];
  labelsEn: string[];
  description: string;
  topics?: string[];
  priority?: number;
  confidence?: string;
  patterns?: string[];
}

// Value capture groups by type
const VALUE_CAPTURE: Record<string, string> = {
  string: "(.{3,120})",
  integer: "(\\d[\\d\\s]*\\d|\\d+)",
  float: "(\\d+[.,]\\d+)",
  date: "(\\d{1,2}[./]\\d{1,2}[./]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\s+\\S+\\s+\\d{4})",
  boolean: "(да|нет|yes|no|true|false)",
  duration: "(.{3,80})",
  range: "(.{3,60})",
  ratio: "(.{2,40})",
  list: "(.{3,200})",
  object: "(.{3,150})",
};

// Custom patterns for specific fact keys that need special handling
const CUSTOM_PATTERNS: Record<string, string[]> = {
  phase: [
    "(?:фаз[аыеу]|phase)\\s*(I{1,3}V?(?:\\/I{1,3})?|[1-4](?:\\/[1-4])?)",
    "(?i)(?:первой|второй|третьей|четвёртой|1-й|2-й|3-й|4-й)\\s+фаз[ыеу]",
  ],
  protocol_id: [
    "(?:номер\\s+(?:протокол|исследовани)|код\\s+исследовани|study\\s*(?:id|number)|protocol\\s*(?:no\\.?|number|#))\\s*[:：\\s]\\s*([A-ZА-Яa-zа-я0-9][A-ZА-Яa-zа-я0-9\\-_./]+)",
  ],
  protocol_date: [
    "(?:дата\\s+(?:протокол|редакци|утверждени)|protocol\\s+date|release\\s+date)\\s*[:：\\s]\\s*(\\d{1,2}[./]\\d{1,2}[./]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\s+\\S+\\s+\\d{4})",
  ],
  protocol_version: [
    "(?:версия\\s+(?:протокол|№)|редакция\\s+(?:протокол|№)|protocol\\s+version|amendment\\s+(?:no\\.?|number))\\s*[:：\\s]\\s*([^\\n]{1,40})",
  ],
  sponsor_name: [
    "(?:спонсор|sponsor)\\s*[:：\\s]\\s*([^\\n]{3,80})",
    "(?:спонсируемое|sponsored\\s+by)\\s*[:：\\s]?\\s*([^\\n]{3,80})",
  ],
  study_title: [
    "(?:название\\s+исследовани|study\\s+title|title\\s+of\\s+(?:the\\s+)?study|protocol\\s+title)\\s*[:：\\s]\\s*([^\\n]{5,200})",
  ],
  therapeutic_area: [
    "(?:терапевтическ\\w+\\s+област|показани[ея]|для\\s+лечения|indication|therapeutic\\s+area)\\s*[:：\\s]\\s*([^\\n]{3,120})",
  ],
  planned_n_total: [
    "(?:всего|общее\\s+число|величина\\s+выборки|объ[её]м\\s+выборки|размер\\s+выборки|total\\s+(?:of\\s+)?|sample\\s+size|planned\\s+enrollment)\\s*[:：\\s]?\\s*(\\d[\\d\\s]*\\d|\\d+)\\s*(?:доброволь|участни|субъект|пациент|subject|patient|participant)?",
    "(?:с\\s+участием|включает|включено|enroll\\w*)\\s+(\\d+)\\s*(?:доброволь|участни|субъект|пациент|subject|patient|participant)",
    "N\\s*=\\s*(\\d+)",
  ],
  planned_sample_size: [
    "(?:с\\s+участием|включает|включено|enroll\\w*)\\s+(\\d+)\\s*(?:доброволь|участни|субъект|пациент|subject|patient|participant)",
    "(?:количеств\\w+\\s+доброволь|число\\s+(?:доброволь|участни))\\s*[:：\\s—–-]\\s*(\\d+)",
  ],
  age_min: [
    "(?:возраст\\s+(?:от|≥|>=)|(?:старше|не\\s+моложе))\\s*(\\d+)\\s*(?:лет|год|years?)",
    "(?:age\\s*(?:≥|>=|from|range))\\s*(\\d+)",
  ],
  age_range: [
    "(?:возраст|age)\\s*(?:от|from)?\\s*(\\d+)\\s*(?:до|to|-|–)\\s*(\\d+)\\s*(?:лет|год|years?)",
    "(\\d+)\\s*[-–]\\s*(\\d+)\\s*(?:лет|год|years?)",
  ],
  gender: [
    "(?:пол|sex|gender)\\s*[:：\\s]\\s*(муж\\w+|жен\\w+|оба\\s+пол\\w*|male|female|both)",
    "(?:здоров\\w+\\s+)(мужчин\\w*|женщин\\w*|доброволь\\w+\\s+(?:мужского|женского)\\s+пол\\w*)",
  ],
  population_type: [
    "(здоров\\w+\\s+доброволь\\w+|здоров\\w+\\s+субъект\\w*|пациент\\w*\\s+с\\s+[^\\n]{3,60})",
    "(healthy\\s+volunteer\\w*|healthy\\s+subject\\w*|patient\\w*\\s+with\\s+[^\\n]{3,60})",
  ],
  duration: [
    "(?:продолжительность\\s+исследовани|длительность\\s+исследовани|сроки\\s+проведения|study\\s+duration|study\\s+timelines?)\\s*[:：\\s—–-]\\s*([^\\n]{3,80})",
  ],
  subject_involvement_duration: [
    "(?:длительность\\s+участия\\s+(?:одного\\s+)?доброволь|продолжительност\\w+\\s+участи)\\s*[:：\\s—–-]\\s*([^\\n]{3,80})",
  ],
  treatment_duration: [
    "(?:длительность\\s+(?:курса\\s+)?лечени|лечение\\s+в\\s+течение|при[её]м\\s+в\\s+течение|treatment\\s+duration|duration\\s+of\\s+treatment)\\s*[:：\\s—–-]\\s*([^\\n]{3,80})",
  ],
  dosage: [
    "(?:в\\s+дозе|доз[аеу]|дозировк\\w+|dose|dosage)\\s*[:：\\s]?\\s*(\\d+[.,]?\\d*\\s*(?:мг|мкг|мл|г|mg|mcg|µg|ml|g|IU|ЕД)(?:[^\\n]{0,40})?)",
  ],
  dosage_form: [
    "(?:лекарственн\\w+\\s+форм\\w+|форм\\w+\\s+выпуск\\w+|dosage\\s+form|formulation)\\s*[:：\\s—–-]\\s*([^\\n]{3,60})",
  ],
  dosage_regimen: [
    "(?:доз\\w+\\s+и\\s+способ\\s+введени|режим\\s+дозировани|dosage\\s+and\\s+mode|dosage\\s+regimen)\\s*[:：\\s—–-]\\s*([^\\n]{3,120})",
  ],
  route: [
    "(?:путь\\s+введени|способ\\s+введени|route\\s+of\\s+administration)\\s*[:：\\s—–-]\\s*([^\\n]{3,60})",
    "(перорально|внутривенно|подкожно|внутримышечно|oral(?:ly)?|intravenous(?:ly)?|subcutaneous(?:ly)?|intramuscular(?:ly)?)",
  ],
  frequency: [
    "(\\d+\\s*раз[а]?\\s+в\\s+(?:день|сутки|неделю)|дважды\\s+в\\s+(?:день|сутки)|ежедневно|еженедельно|once\\s+daily|twice\\s+daily|(?:q\\.?d\\.?|b\\.?i\\.?d\\.?|t\\.?i\\.?d\\.?))",
  ],
  imp_name: [
    "(?:исследуемый\\s+препарат|исследуемое\\s+лекарственное\\s+средство|test\\s+product|investigational\\s+(?:medicinal\\s+)?product|ИП|IMP|IP)\\s*[:：\\s—–-]\\s*([^\\n]{3,80})",
  ],
  ip_name: [
    "(?:исследуемый\\s+препарат|ИП|investigational\\s+product|study\\s+drug|IP)\\s*[:：\\s—–-]\\s*([^\\n]{3,80})",
  ],
  comparator_name: [
    "(?:препарат\\s+сравнени|активный\\s+контрол|плацебо|comparator|reference\\s+drug|active\\s+control)\\s*[:：\\s—–-]\\s*([^\\n]{3,80})",
  ],
  mechanism_of_action: [
    "(?:механизм\\s+действи|mechanism\\s+of\\s+action)\\s*[:：\\s—–-]\\s*([^\\n]{5,150})",
  ],
  objectives: [
    "(?:цел[ьи]\\s+исследовани|study\\s+objective|objective\\s+of\\s+(?:the\\s+)?study)\\s*[:：\\s—–-]\\s*([^\\n]{5,200})",
  ],
  tasks: [
    "(?:задач[иа]\\s+исследовани)\\s*[:：\\s—–-]\\s*([^\\n]{5,200})",
  ],
  primary: [
    "(?:первичн\\w+\\s+конечн\\w+\\s+точк|основн\\w+\\s+(?:конечн\\w+\\s+точк|критери\\w+\\s+эффективност)|primary\\s+(?:endpoint|outcome|objective))\\s*[:：\\s—–-]\\s*([^\\n]{5,200})",
  ],
  secondary: [
    "(?:вторичн\\w+\\s+конечн\\w+\\s+точк|вторичн\\w+\\s+цел|secondary\\s+(?:endpoint|objective|outcome))\\s*[:：\\s—–-]\\s*([^\\n]{5,200})",
  ],
  safety_assessments: [
    "(?:параметр\\w+\\s+безопасност|критери\\w+\\s+безопасност|safety\\s+(?:assessment|objective|endpoint))\\s*[:：\\s—–-]\\s*([^\\n]{5,200})",
  ],
  inclusion_criteria: [
    "(?:критери\\w+\\s+включени|inclusion\\s+criteria)\\s*[:：\\s]\\s*([^\\n]{5,200})",
  ],
  exclusion_criteria: [
    "(?:критери\\w+\\s+(?:не)?включени|exclusion\\s+criteria)\\s*[:：\\s]\\s*([^\\n]{5,200})",
  ],
  withdrawal_criteria: [
    "(?:критери\\w+\\s+(?:досрочного\\s+)?(?:исключени|выведени)|withdrawal\\s+criteria)\\s*[:：\\s]\\s*([^\\n]{5,200})",
  ],
  site_count: [
    "(?:числ\\w+\\s+(?:исследовательских\\s+)?центр|количеств\\w+\\s+центр|number\\s+of\\s+(?:study\\s+)?sites?)\\s*[:：\\s—–-]\\s*(\\d+)",
  ],
  study_sites: [
    "(?:исследовательск\\w+\\s+центр|study\\s+(?:location|site))\\s*[:：\\s—–-]\\s*([^\\n]{3,120})",
  ],
  "design.description": [
    "(?:дизайн\\s+исследовани|study\\s+design|trial\\s+design)\\s*[:：\\s—–-]\\s*([^\\n]{5,200})",
  ],
  "design.type": [
    "((?:в\\s+)?параллельн\\w+(?:\\s+групп\\w*)?|перекр[её]стн\\w+|кроссовер\\w*|parallel(?:\\s+group)?|crossover|cross-over)",
  ],
  "design.randomized": [
    "(рандомизированн\\w+|с\\s+рандомизацией|randomized|RCT)",
  ],
  "design.blinding": [
    "(открыт\\w+|(?:двойн\\w+\\s+)?слеп\\w+|заслеплен\\w+|open[- ]label|double[- ]blind|single[- ]blind|blinded|placebo[- ]controlled)",
  ],
  "design.masking": [
    "(открыт\\w+\\s+исследовани\\w+|двойн\\w+\\s+слеп\\w+\\s+исследовани\\w+|одинарн\\w+\\s+слеп\\w+)",
    "(open[- ]label\\s+study|double[- ]blind\\s+study|single[- ]blind\\s+study)",
  ],
  "design.control_type": [
    "(плацебо[- ]контролируем\\w*|плацебо|активн\\w+\\s+контрол\\w+|без\\s+контрол\\w+|placebo[- ]controlled|active[- ]controlled|uncontrolled)",
  ],
  "design.randomization_ratio": [
    "(?:соотношении|соотношение|рандомизированы|randomiz\\w+\\s+(?:in\\s+(?:a\\s+)?)?(?:ratio)?)\\s*[:：\\s]?\\s*(\\d+\\s*[:：]\\s*\\d+(?:\\s*[:：]\\s*\\d+)?)",
  ],
  "design.rationale": [
    "(?:обоснование\\s+дизайн|rationale)\\s*[:：\\s—–-]\\s*([^\\n]{5,200})",
  ],
  "design.interim_analysis": [
    "(промежуточн\\w+\\s+анализ|interim\\s+analysis)",
  ],
  "design.configuration": [
    "(параллельн\\w+|перекрёстн\\w+|факторн\\w+|двухэтапн\\w+|parallel\\s+group|crossover\\s+design|factorial\\s+design|two-stage\\s+design)",
  ],
  blinding: [
    "(заслеплени\\w+|двойн\\w+\\s+слеп\\w+|одинарн\\w+\\s+слеп\\w+|открыт\\w+|blinding|double[- ]blind|single[- ]blind|open[- ]label)",
  ],
  population_description: [
    "(?:исследуем\\w+\\s+популяци|study\\s+population)\\s*[:：\\s—–-]\\s*([^\\n]{5,150})",
  ],
  analysis_method: [
    "(?:статистическ\\w+\\s+анализ|statistical\\s+analysis)\\s*[:：\\s—–-]?\\s*(?:использовал\\w*|применял\\w*|was\\s+used|was\\s+applied)?\\s*([^\\n]{3,120})",
  ],
  alpha: [
    "(?:уровень\\s+значимост|альфа|significance\\s+level|alpha)\\s*[:：\\s=]\\s*(0[.,]\\d+|\\d+\\s*%)",
  ],
  half_life: [
    "(?:период\\s+полувыведени|T1?\\/2|Т1?\\/2|half[- ]life|elimination\\s+half[- ]life)\\s*[:：\\s=—–-]\\s*([^\\n]{2,60})",
  ],
  washout_period: [
    "(?:период\\s+(?:отмывки|washout)|washout\\s+period|отмывочн\\w+\\s+период)\\s*[:：\\s—–-]\\s*([^\\n]{2,60})",
  ],
  pk_parameters: [
    "(?:фармакокинетическ\\w+\\s+параметр|параметр\\w+\\s+фармакокинетик|pk\\s+parameter|pharmacokinetic\\s+parameter)\\s*[:：\\s—–-]\\s*([^\\n]{3,200})",
  ],
  blood_sampling_volume: [
    "(?:объ[её]м\\s+(?:забора\\s+)?крови|всего\\s+крови|blood\\s+(?:sampling\\s+)?volume|total\\s+blood\\s+volume)\\s*[:：\\s—–-]\\s*([^\\n]{2,80})",
  ],
  fasting_condition: [
    "(натощак|после\\s+еды|на\\s+голодн\\w+\\s+желуд\\w+|после\\s+при[её]ма\\s+пищ\\w+|fasting|fed\\s+condition|non-fasting)",
  ],
  analytes: [
    "(?:аналит\\w*|analyte)\\s*[:：\\s—–-]\\s*([^\\n]{3,120})",
  ],
  concomitant_therapy: [
    "(?:сопутствующ\\w+\\s+терапи|concomitant\\s+therapy)\\s*[:：\\s—–-]\\s*([^\\n]{5,150})",
  ],
  prohibited_therapy: [
    "(?:запрещ[её]нн\\w+\\s+(?:терапи|препарат)|prohibited\\s+(?:medication|therapy))\\s*[:：\\s—–-]\\s*([^\\n]{5,150})",
  ],
  manufacturer: [
    "(?:производител\\w+|manufacturer)\\s*[:：\\s—–-]\\s*([^\\n]{3,80})",
  ],
};

async function main() {
  const rules = await prisma.$queryRaw<Array<{ id: string; pattern: string; config: any }>>`
    SELECT r.id, r.pattern, r.config
    FROM rules r
    JOIN rule_set_versions rsv ON rsv.id = r.rule_set_version_id
    JOIN rule_sets rs ON rs.id = rsv.rule_set_id
    WHERE rs.name = 'Реестр фактов клинического протокола v1'
    AND r.is_enabled = true
    ORDER BY (r.config->>'category'), r."order"
  `;

  console.log(`Found ${rules.length} fact rules`);
  let updated = 0;
  let skipped = 0;

  for (const rule of rules) {
    const cfg = rule.config as FactConfig;

    if (cfg.patterns && cfg.patterns.length > 0) {
      skipped++;
      continue;
    }

    const patterns = CUSTOM_PATTERNS[rule.pattern];
    if (!patterns || patterns.length === 0) {
      console.warn(`No custom patterns for: ${rule.pattern} (${cfg.category})`);
      skipped++;
      continue;
    }

    const newConfig = { ...cfg, patterns };

    await prisma.$executeRaw`
      UPDATE rules SET config = ${JSON.stringify(newConfig)}::jsonb WHERE id = ${rule.id}::uuid
    `;
    updated++;
    console.log(`Updated: ${cfg.category}.${rule.pattern} → ${patterns.length} pattern(s)`);
  }

  console.log(`\nDone: ${updated} updated, ${skipped} skipped`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
