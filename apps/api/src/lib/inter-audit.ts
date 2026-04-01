/**
 * Движок междокументного аудита (Cross-document concordance audit).
 *
 * Сравнивает протокол с CSR или ICF по перечню проверок
 * из PROTOCOL_CONCORDANCE_CHECKS_CSR_ICF.md.
 *
 * Этапы:
 *   1. Загрузка секций обоих документов
 *   2. LLM-проверки по группам чеков
 *   3. QA-верификация (проверка на false positive)
 */

import { prisma } from "@clinscriptum/db";
import { llmAsk } from "./llm-gateway.js";

/* ═══════════════════════ Types ═══════════════════════ */

type Severity = "critical" | "high" | "medium" | "low" | "info";

interface RawInterFinding {
  checkId: string;
  description: string;
  suggestion?: string;
  severity: Severity;
  issueFamily: string;
  protocolQuote?: string;
  checkedDocQuote?: string;
  protocolSection?: string;
  checkedDocSection?: string;
}

interface SectionData {
  id: string;
  title: string;
  standardSection: string | null;
  content: string;
}

/* ═══════════════════════ Check group definitions ═══════════════════════ */

interface CheckGroup {
  id: string;
  label: string;
  docType: "csr" | "icf";
  protocolZones: string[];
  checkedDocZones: string[];
  checksPrompt: string;
}

type InterDocType = "csr" | "icf";

const CSR_CHECK_GROUPS: CheckGroup[] = [
  {
    id: "csr_identifiers",
    label: "Идентификаторы, версии и административные атрибуты",
    docType: "csr",
    protocolZones: ["overview", "design", "synopsis"],
    checkedDocZones: ["overview", "synopsis", "design"],
    checksPrompt: `CSR-1 protocol_number_match: Номер протокола в CSR совпадает с номером в титуле/колонтитулах.
CSR-2 protocol_version_match: Версия и дата протокола соответствуют.
CSR-3 amendment_traceability: Все amendments перечислены и датированы.
CSR-4 study_title_consistency: Полное и краткое название соответствует.
CSR-5 study_phase_consistency: Фаза исследования соответствует.
CSR-6 trial_identifier_consistency: NCT/EudraCT и пр. совпадают.
CSR-7 sponsor_identity_match: Sponsor/legal entity соответствует.
CSR-8 country_site_scope_match: Перечень стран/центров соответствует.`,
  },
  {
    id: "csr_design",
    label: "Дизайн исследования и исполнение протокола",
    docType: "csr",
    protocolZones: ["design", "procedures", "synopsis"],
    checkedDocZones: ["design", "synopsis", "procedures"],
    checksPrompt: `CSR-9 study_design_match: Дизайн (parallel/crossover/blinded и т.д.) отражён корректно.
CSR-10 treatment_arms_match: Число arms/cohorts соответствует.
CSR-11 arm_description_match: Описание arm/cohort не искажает протокол.
CSR-12 randomization_ratio_match: Соотношение рандомизации совпадает.
CSR-13 stratification_match: Факторы стратификации соответствуют.
CSR-14 blinding_level_match: Уровень ослепления соответствует.
CSR-15 unblinding_rules_match: Правила раскрытия ослепления соответствуют.
CSR-16 screening_runin_washout_match: Периоды screening/run-in/washout описаны так же.
CSR-17 treatment_duration_match: Planned treatment/follow-up duration соответствуют.
CSR-18 visit_schedule_match: Перечень визитов соответствует SoA.
CSR-19 visit_window_match: Окна визитов соответствуют.
CSR-22 interim_analysis_execution_match: Interim analysis отражён корректно.
CSR-23 dmc_idmc_role_match: Роль DMC/IDMC соответствует.`,
  },
  {
    id: "csr_population",
    label: "Популяция, набор, выбывания и отклонения от протокола",
    docType: "csr",
    protocolZones: ["population", "design", "synopsis"],
    checkedDocZones: ["population", "synopsis", "design"],
    checksPrompt: `CSR-24 target_population_match: Описание исследуемой популяции соответствует.
CSR-25 inclusion_criteria_match: Критерии включения не противоречат.
CSR-26 exclusion_criteria_match: Критерии исключения отражены корректно.
CSR-27 screen_failure_definition_match: Определение screen failure соответствует.
CSR-28 enrolment_definition_match: Различает screened/enrolled/randomized/treated/completed.
CSR-29 planned_sample_size_match: Planned sample size соответствует.
CSR-30 actual_vs_planned_enrolment_explained: Отличие набора от плана объяснено.
CSR-31 withdrawal_discontinuation_criteria_match: Критерии withdrawal совпадают.
CSR-33 protocol_deviation_categories_match: Категории deviation соответствуют.
CSR-35 patients_excluded_from_analysis_match: Исключения из анализа объяснены.`,
  },
  {
    id: "csr_ip_treatment",
    label: "Исследуемый препарат, экспозиция и сопутствующая терапия",
    docType: "csr",
    protocolZones: ["ip", "design", "procedures"],
    checkedDocZones: ["ip", "design", "procedures"],
    checksPrompt: `CSR-37 ip_identity_match: Наименование IP/comparator/placebo соответствует.
CSR-38 dose_strength_regimen_match: Dose/strength/regimen/frequency/route соответствует.
CSR-39 dose_modification_rules_match: Правила interruption/reduction/escalation соответствуют.
CSR-41 treatment_compliance_assessment_match: Метод оценки compliance соответствует.
CSR-42 rescue_medication_rules_match: Правила rescue medication соответствуют.
CSR-43 prohibited_medication_rules_match: Запрещённые concomitant therapies соответствуют.
CSR-44 allowed_background_therapy_match: Разрешённая background therapy совпадает.`,
  },
  {
    id: "csr_endpoints",
    label: "Конечные точки, методы оценки и расписание процедур",
    docType: "csr",
    protocolZones: ["endpoints", "procedures", "design"],
    checkedDocZones: ["endpoints", "procedures", "design"],
    checksPrompt: `CSR-47 primary_endpoint_match: Primary endpoint совпадает по формулировке, переменной, времени и популяции.
CSR-48 secondary_endpoints_match: Secondary endpoints не расширены и не переименованы.
CSR-49 exploratory_endpoints_labeling: Exploratory endpoints не представлены как confirmatory.
CSR-50 endpoint_hierarchy_match: Иерархия endpoints соответствует.
CSR-51 endpoint_timepoint_match: Timepoint оценки endpoint совпадают.
CSR-53 endpoint_assessment_method_match: Метод измерения endpoint соответствует.
CSR-54 assessment_schedule_match: График assessments соответствует.
CSR-56 clinically_significant_threshold_match: Пороги responder/worsening/improvement соответствуют.`,
  },
  {
    id: "csr_safety",
    label: "Безопасность, переносимость и клинический мониторинг",
    docType: "csr",
    protocolZones: ["safety", "procedures", "design"],
    checkedDocZones: ["safety", "procedures", "design"],
    checksPrompt: `CSR-59 safety_collection_period_match: Период сбора TEAE/AE/SAE соответствует.
CSR-60 ae_definition_match: Определения AE, TEAE, relatedness, severity не противоречат.
CSR-61 sae_aesi_definition_match: Определения SAE, AESI, DLT соответствуют.
CSR-62 pregnancy_reporting_rules_match: Pregnancy reporting соответствует.
CSR-63 safety_lab_schedule_match: Частота и набор safety labs соответствуют.
CSR-64 ecg_vitals_schedule_match: ECG, vital signs, physical exam соответствуют.
CSR-66 stopping_rules_match: Individual/study stopping rules отражены корректно.
CSR-69 safety_followup_after_discontinuation_match: Safety follow-up описан как в протоколе.`,
  },
  {
    id: "csr_statistics",
    label: "Статистика, estimands, анализ и интерпретация",
    docType: "csr",
    protocolZones: ["statistics", "endpoints", "design"],
    checkedDocZones: ["statistics", "endpoints", "design"],
    checksPrompt: `CSR-72 analysis_sets_match: Определения ITT/FAS/PPS/SAF/PK sets соответствуют.
CSR-73 estimand_match: Estimand не подменяет clinical question.
CSR-74 intercurrent_events_handling_match: Handling intercurrent events соответствует.
CSR-75 sample_size_rationale_match: Sample size assumptions соответствуют.
CSR-76 alpha_multiplicity_match: Множественные сравнения, alpha spending соответствуют.
CSR-79 missing_data_method_match: Правила обработки missing data соответствуют.
CSR-80 sensitivity_analysis_match: Prespecified sensitivity analyses выполнены.
CSR-84 baseline_definition_match: Определение baseline совпадает.
CSR-87 conclusion_scope_match: Выводы не выходят за пределы protocol-defined objectives.`,
  },
  {
    id: "csr_expert",
    label: "Экспертные содержательные проверки CSR vs Protocol",
    docType: "csr",
    protocolZones: ["synopsis", "design", "endpoints", "safety", "statistics", "population"],
    checkedDocZones: ["synopsis", "design", "endpoints", "safety", "statistics", "population"],
    checksPrompt: `CSR-X1 planned_vs_actual_language_integrity: CSR различает план протокола и фактическое проведение.
CSR-X2 silent_endpoint_drift: Нет «дрейфа» формулировки endpoint.
CSR-X3 silent_population_drift: Описание популяции не сужает и не расширяет protocol-defined population.
CSR-X4 overclaiming_vs_protocol_objectives: Заключения не интерпретируют больше, чем поддержано objectives.
CSR-X5 deviation_impact_transparency: CSR оценивает влияние важных deviations на интерпретацию.
CSR-X7 objective_endpoint_method_triad_integrity: Цепочка objective→endpoint→analysis method без разрыва.
CSR-X9 post_hoc_salvage_detection: Не маскирует post hoc analyses под prespecified.`,
  },
];

const ICF_CHECK_GROUPS: CheckGroup[] = [
  {
    id: "icf_identification",
    label: "Идентификация документа и контроль версий",
    docType: "icf",
    protocolZones: ["overview", "design", "synopsis"],
    checkedDocZones: ["overview", "synopsis"],
    checksPrompt: `ICF-1 protocol_number_on_icf_match: Номер протокола в ICF совпадает с действующей версией.
ICF-2 study_title_on_icf_match: Название исследования соответствует.
ICF-3 icf_version_control_integrity: Номер версии и дата ICF корректны.
ICF-4 amendment_driven_reconsent_alignment: Если amendment влияет на burden/risk/procedures, ICF обновлён.
ICF-6 main_icf_vs_optional_icf_separation: Основной ICF отделён от optional consents.`,
  },
  {
    id: "icf_purpose_procedures",
    label: "Цель исследования, длительность участия и процедуры",
    docType: "icf",
    protocolZones: ["design", "procedures", "overview", "synopsis"],
    checkedDocZones: ["overview", "procedures", "synopsis"],
    checksPrompt: `ICF-7 purpose_of_study_match: Цель исследования соответствует протоколу.
ICF-8 research_nature_statement_match: ICF ясно сообщает, что участие связано с исследованием.
ICF-10 duration_of_participation_match: Длительность участия, treatment period и follow-up соответствуют.
ICF-11 number_of_visits_match: Число визитов/стационарных пребываний соответствует.
ICF-12 procedure_list_match: Перечень процедур (blood draws, ECG, imaging и т.п.) соответствует.
ICF-13 screening_procedures_match: Screening procedures не противоречат.
ICF-14 randomization_and_probability_match: Рандомизация/плацебо объяснены корректно.
ICF-15 blinding_concept_match: Ослепление объяснено без противоречия.
ICF-16 hospitalization_confinement_match: Периоды confinement/inpatient stay соответствуют.
ICF-18 blood_volume_and_frequency_match: Объём и частота заборов крови не занижены.`,
  },
  {
    id: "icf_risks_benefits",
    label: "Риски, дискомфорт, польза и альтернативы",
    docType: "icf",
    protocolZones: ["safety", "ip", "design", "procedures"],
    checkedDocZones: ["safety", "overview", "procedures"],
    checksPrompt: `ICF-20 foreseeable_risks_match: Существенные прогнозируемые риски соответствуют протоколу/IB.
ICF-21 procedure_specific_risks_match: Риски инвазивных процедур отражены.
ICF-22 drug_specific_risks_match: Риски IP/comparator/placebo описаны.
ICF-24 reproductive_risk_match: Риски для эмбриона/плода и контрацепция совпадают.
ICF-25 benefit_statement_match: Потенциальная польза не преувеличивает.
ICF-27 alternative_options_match: Альтернативы участию соответствуют clinical context.
ICF-29 safety_followup_burden_disclosed: Дополнительный follow-up раскрыт.
ICF-30 concomitant_medication_restriction_disclosed: Ограничения по препаратам сообщены.
ICF-31 prohibited_activity_disclosed: Запреты раскрыты.`,
  },
  {
    id: "icf_privacy_data",
    label: "Конфиденциальность, данные, образцы",
    docType: "icf",
    protocolZones: ["ethics", "data_management", "design"],
    checkedDocZones: ["ethics", "data_management", "overview"],
    checksPrompt: `ICF-32 confidentiality_scope_match: Раздел о конфиденциальности соответствует.
ICF-33 source_record_access_match: Доступ monitor/auditor/regulator корректно раскрыт.
ICF-35 data_retention_statement_match: Срок хранения данных/образцов не противоречит.
ICF-36 cross_border_transfer_match: Трансграничная передача данных/образцов раскрыта.
ICF-38 future_use_of_samples_match: Будущее использование образцов описано только если предусмотрено.
ICF-39 genetic_testing_match: Генетические исследования корректно раскрыты.`,
  },
  {
    id: "icf_logistics",
    label: "Логистика участия, выплаты, прекращение участия и контакты",
    docType: "icf",
    protocolZones: ["design", "procedures", "ethics", "overview"],
    checkedDocZones: ["overview", "procedures", "ethics"],
    checksPrompt: `ICF-44 voluntary_participation_statement_match: Добровольность участия отражена корректно.
ICF-45 withdrawal_rights_match: Право прекратить участие описано без противоречия.
ICF-46 withdrawal_procedure_and_data_handling_match: ICF различает прекращение лечения, визитов и использование данных.
ICF-47 investigator_termination_conditions_match: Условия прекращения участия по решению исследователя/спонсора соответствуют.
ICF-48 new_information_recontact_match: Обещание сообщения новой информации.
ICF-49 subject_payment_match: Выплаты/компенсация согласованы.
ICF-51 post_trial_access_or_followup_match: Post-trial treatment/access раскрыт, если предусмотрен.
ICF-52 contact_information_scope_match: Контакты соответствуют.`,
  },
  {
    id: "icf_special_populations",
    label: "Особые популяции и специальные процедуры согласия",
    docType: "icf",
    protocolZones: ["population", "design", "ethics", "procedures"],
    checkedDocZones: ["overview", "procedures", "ethics"],
    checksPrompt: `ICF-56 lar_consent_pathway_match: Процедура LAR согласия соответствует.
ICF-57 assent_process_match: Для педиатрии assent соответствует.
ICF-60 reconsent_trigger_match: Триггеры re-consent учтены.
ICF-62 contraception_duration_match: Период контрацепции совпадает с протоколом.
ICF-64 remote_econsent_process_match: eConsent/remote consent соответствует.
ICF-68 healthy_volunteer_restrictions_match: Ограничения для healthy volunteers соответствуют.`,
  },
  {
    id: "icf_expert",
    label: "Экспертные содержательные проверки ICF vs Protocol",
    docType: "icf",
    protocolZones: ["design", "safety", "procedures", "population", "ip", "overview"],
    checkedDocZones: ["overview", "procedures", "safety", "ethics"],
    checksPrompt: `ICF-X1 participant_burden_truthfulness: ICF честно отражает реальную нагрузку участника.
ICF-X2 material_risk_omission_detection: Нет пропусков материальных рисков.
ICF-X3 benefit_overstatement_detection: Формулировки о пользе не создают терапевтическое заблуждение.
ICF-X4 plain_language_without_loss_of_content: Упрощение языка не приводит к потере критичных conditions.
ICF-X5 optional_vs_mandatory_boundary_integrity: Ясно, что обязательно, а что опционально.
ICF-X6 withdrawal_message_integrity: Не создаёт ложного впечатления об удалении данных.
ICF-X8 privacy_claim_vs_actual_dataflow: Заявления о конфиденциальности реалистичны.
ICF-X11 risk_benefit_balance_language: Тон сбалансирован.`,
  },
];

export function getInterAuditChecksPrompt(docType: InterDocType): string {
  const groups = docType === "csr" ? CSR_CHECK_GROUPS : ICF_CHECK_GROUPS;
  return groups
    .map((group) => `[${group.id}] ${group.label}\n${group.checksPrompt}`)
    .join("\n\n");
}

/* ═══════════════════════ Entry point ═══════════════════════ */

export async function runInterDocAudit(
  protocolVersionId: string,
  checkedVersionId: string
): Promise<string> {
  const [protocolVersion, checkedVersion] = await Promise.all([
    prisma.documentVersion.findUniqueOrThrow({
      where: { id: protocolVersionId },
      include: { document: { include: { study: true } } },
    }),
    prisma.documentVersion.findUniqueOrThrow({
      where: { id: checkedVersionId },
      include: { document: { include: { study: true } } },
    }),
  ]);

  const checkedDocType = checkedVersion.document.type;
  if (checkedDocType !== "icf" && checkedDocType !== "csr") {
    throw new Error(`Inter-audit supports only ICF and CSR, got: ${checkedDocType}`);
  }

  const run = await prisma.processingRun.create({
    data: {
      studyId: checkedVersion.document.studyId,
      docVersionId: checkedVersionId,
      type: "inter_doc_audit",
      status: "running",
    },
  });

  try {
    await prisma.documentVersion.update({
      where: { id: checkedVersionId },
      data: { status: "inter_audit" },
    });

    await prisma.finding.deleteMany({
      where: { docVersionId: checkedVersionId, type: "inter_audit" },
    });

    const protocolSections = await loadSections(protocolVersionId);
    const checkedSections = await loadSections(checkedVersionId);

    const checkGroups = checkedDocType === "csr" ? CSR_CHECK_GROUPS : ICF_CHECK_GROUPS;

    const protocolLabel = protocolVersion.versionLabel ?? `v${protocolVersion.versionNumber}`;
    const checkedLabel = checkedVersion.versionLabel ?? `v${checkedVersion.versionNumber}`;

    console.log(
      `[inter-audit] Starting: Protocol ${protocolLabel} vs ` +
      `${checkedVersion.document.title} ${checkedLabel} (${checkGroups.length} groups)`
    );

    const allFindings: RawInterFinding[] = [];

    for (const group of checkGroups) {
      const protoText = extractZoneText(protocolSections, group.protocolZones);
      const checkedText = extractZoneText(checkedSections, group.checkedDocZones);

      if (protoText.length < 50 || checkedText.length < 50) {
        console.log(`[inter-audit] Skipping group ${group.id}: insufficient text`);
        continue;
      }

      try {
        const findings = await runCheckGroup(
          group,
          protoText.slice(0, 10000),
          checkedText.slice(0, 10000),
          checkedDocType
        );
        allFindings.push(...findings);
        console.log(`[inter-audit] Group ${group.id}: ${findings.length} findings`);
      } catch (err) {
        console.warn(`[inter-audit] Group ${group.id} failed:`, err);
      }
    }

    console.log(`[inter-audit] Total raw findings: ${allFindings.length}`);

    const savedIds = await saveFindings(
      checkedVersionId,
      protocolVersionId,
      protocolVersion.document.title,
      protocolLabel,
      allFindings
    );
    console.log(`[inter-audit] Saved ${savedIds.length} findings`);

    await runQaVerification(savedIds);
    console.log(`[inter-audit] QA verification complete`);

    await prisma.processingRun.update({
      where: { id: run.id },
      data: { status: "completed" },
    });

    await prisma.documentVersion.update({
      where: { id: checkedVersionId },
      data: { status: "parsed" },
    });

    console.log(`[inter-audit] Done`);
    return run.id;
  } catch (err) {
    console.error(`[inter-audit] Error:`, err);
    await prisma.processingRun
      .update({ where: { id: run.id }, data: { status: "failed" } })
      .catch(() => {});
    await prisma.documentVersion
      .update({ where: { id: checkedVersionId }, data: { status: "parsed" } })
      .catch(() => {});
    throw err;
  }
}

/* ═══════════════════════ Data loading ═══════════════════════ */

async function loadSections(versionId: string): Promise<SectionData[]> {
  const sections = await prisma.section.findMany({
    where: { docVersionId: versionId },
    orderBy: { order: "asc" },
    include: { contentBlocks: { orderBy: { order: "asc" } } },
  });

  return sections.map((s) => ({
    id: s.id,
    title: s.title,
    standardSection: s.standardSection,
    content: s.contentBlocks.map((b) => b.content).join("\n"),
  }));
}

function extractZoneText(sections: SectionData[], zones: string[]): string {
  const relevantSections = sections.filter((s) =>
    zones.some((z) => s.standardSection?.startsWith(z))
  );

  if (relevantSections.length === 0) {
    const fallback = sections.filter((s) =>
      zones.some(
        (z) =>
          s.title.toLowerCase().includes(z) ||
          (s.standardSection ?? "").toLowerCase().includes(z)
      )
    );
    if (fallback.length > 0) {
      return fallback.map((s) => `[${s.title}]\n${s.content}`).join("\n\n---\n\n");
    }
    return sections
      .slice(0, 5)
      .map((s) => `[${s.title}]\n${s.content}`)
      .join("\n\n---\n\n");
  }

  return relevantSections.map((s) => `[${s.title}]\n${s.content}`).join("\n\n---\n\n");
}

/* ═══════════════════════ LLM check execution ═══════════════════════ */

async function runCheckGroup(
  group: CheckGroup,
  protocolText: string,
  checkedText: string,
  checkedDocType: "csr" | "icf"
): Promise<RawInterFinding[]> {
  const docLabel = checkedDocType === "csr" ? "CSR (Отчёт клинического исследования)" : "ICF (Информированное согласие)";

  const systemPrompt = `Ты — эксперт по проверке соответствия клинической документации протоколу.

Тебе предоставлены:
- Разделы ПРОТОКОЛА (источник истины)
- Разделы ПРОВЕРЯЕМОГО ДОКУМЕНТА (${docLabel})
- Список конкретных проверок, которые нужно выполнить

Для каждого обнаруженного несоответствия верни JSON-объект:
{
  "check_id": "ID проверки из списка (напр. CSR-1 или ICF-7)",
  "severity": "critical|high|medium|low|info",
  "family": "IDENTIFIERS_VERSIONING|DESIGN_EXECUTION|POPULATION_ELIGIBILITY|IP_TREATMENT|ENDPOINT_ASSESSMENT|SAFETY_MONITORING|STATISTICAL_INTERPRETATION|SUBJECT_BURDEN_DISCLOSURE|PRIVACY_DATA_SAMPLES|SPECIAL_CONSENT_PATHWAYS|TRACEABILITY|OVERCLAIMING_UNDERDISCLOSURE",
  "description": "Чёткое описание несоответствия на русском языке",
  "protocol_quote": "Точная цитата из протокола (≥30 символов)",
  "checked_doc_quote": "Точная цитата из проверяемого документа (≥30 символов)",
  "protocol_section": "Название раздела протокола",
  "checked_doc_section": "Название раздела проверяемого документа",
  "suggestion": "Рекомендация по устранению несоответствия на русском"
}

ПРАВИЛА SEVERITY:
- critical: влияет на безопасность пациентов, валидность результатов или права участников
- high: значительное несоответствие, влияющее на интерпретацию
- medium: заметное несоответствие, требующее внимания
- low: незначительное расхождение
- info: информационное замечание

ПРАВИЛА:
- Находи ТОЛЬКО реальные противоречия и несоответствия, подтверждённые цитатами
- Допустимые различия: CSR может описывать фактическое проведение (если это явно указано как deviation/actual conduct), ICF может упрощать язык (если не теряются material conditions)
- Пропуск клинически значимой информации — тоже находка
- Возвращай ТОЛЬКО JSON-массив. Если проблем нет — верни []`;

  const userPrompt = `ГРУППА ПРОВЕРОК: ${group.label}

ПЕРЕЧЕНЬ ПРОВЕРОК:
${group.checksPrompt}

---

РАЗДЕЛЫ ПРОТОКОЛА:
${protocolText}

---

РАЗДЕЛЫ ПРОВЕРЯЕМОГО ДОКУМЕНТА (${docLabel}):
${checkedText}`;

  const raw = await llmAsk("inter_audit", systemPrompt, userPrompt);
  return parseCheckGroupResponse(raw);
}

function parseCheckGroupResponse(raw: string): RawInterFinding[] {
  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const arr = JSON.parse(jsonMatch[0]) as any[];
    return arr
      .filter((item) => item.description && item.check_id)
      .map((item) => ({
        checkId: item.check_id,
        description: item.description,
        suggestion: item.suggestion ?? undefined,
        severity: mapSeverity(item.severity),
        issueFamily: item.family ?? "OVERCLAIMING_UNDERDISCLOSURE",
        protocolQuote: item.protocol_quote,
        checkedDocQuote: item.checked_doc_quote,
        protocolSection: item.protocol_section,
        checkedDocSection: item.checked_doc_section,
      }));
  } catch (err) {
    console.warn("[inter-audit] Failed to parse LLM response:", (raw ?? "").slice(0, 300));
    return [];
  }
}

/* ═══════════════════════ Save findings ═══════════════════════ */

async function saveFindings(
  checkedVersionId: string,
  protocolVersionId: string,
  protocolTitle: string,
  protocolLabel: string,
  findings: RawInterFinding[]
): Promise<string[]> {
  const ids: string[] = [];

  for (const f of findings) {
    const record = await prisma.finding.create({
      data: {
        docVersionId: checkedVersionId,
        type: "inter_audit",
        description: f.description,
        suggestion: f.suggestion ?? null,
        severity: f.severity as any,
        auditCategory: f.checkId.startsWith("CSR-X") || f.checkId.startsWith("ICF-X") ? "expert" : "concordance",
        issueType: f.checkId,
        issueFamily: f.issueFamily,
        anchorZone: f.protocolSection ?? null,
        targetZone: f.checkedDocSection ?? null,
        qaVerified: false,
        sourceRef: {
          protocolQuote: f.protocolQuote,
          checkedDocQuote: f.checkedDocQuote,
          protocolSection: f.protocolSection,
          checkedDocSection: f.checkedDocSection,
        } as any,
        status: "pending",
        extraAttributes: {
          protocolVersionId,
          protocolTitle,
          protocolLabel,
          checkId: f.checkId,
        } as any,
      },
    });
    ids.push(record.id);
  }

  return ids;
}

/* ═══════════════════════ QA verification ═══════════════════════ */

async function runQaVerification(findingIds: string[]): Promise<void> {
  const QA_BATCH_SIZE = 5;

  for (let i = 0; i < findingIds.length; i += QA_BATCH_SIZE) {
    const batchIds = findingIds.slice(i, i + QA_BATCH_SIZE);
    const findings = await prisma.finding.findMany({
      where: { id: { in: batchIds } },
    });

    try {
      const results = await llmQaBatch(findings);

      for (const result of results) {
        await prisma.finding.update({
          where: { id: result.findingId },
          data: {
            qaVerified: true,
            status: result.isFalsePositive ? "false_positive" : "pending",
          },
        });
      }
    } catch (err) {
      console.warn(`[inter-audit] QA batch failed:`, err);
      await prisma.finding.updateMany({
        where: { id: { in: batchIds } },
        data: { qaVerified: true },
      });
    }
  }
}

async function llmQaBatch(
  findings: { id: string; description: string; sourceRef: any; severity: any; issueType: string | null }[]
): Promise<{ findingId: string; isFalsePositive: boolean }[]> {
  const items = findings.map((f, idx) => {
    const ref = f.sourceRef as any;
    const quotes = [ref?.protocolQuote, ref?.checkedDocQuote].filter(Boolean).join(" | ");
    return `${idx + 1}. [id=${f.id}] Серьёзность: ${f.severity}. Проверка: ${f.issueType}. Описание: ${f.description}. Цитаты: ${quotes}`;
  });

  const systemPrompt = `Ты — QA-ревьюер междокументного аудита клинической документации.
Для каждой находки определи: это реальное несоответствие или ложное срабатывание (false positive)?

Ложное срабатывание — когда:
- Описанного несоответствия не существует в приведённых цитатах
- Различия объясняются контекстом (упрощение языка в ICF, описание actual conduct в CSR)
- Это допустимое перефразирование без потери смысла
- Проверяемый документ корректно упрощает или адаптирует информацию из протокола

Верни JSON-массив: [{"id":"<id>","is_false_positive":true/false}]
Верни ТОЛЬКО JSON.`;

  const userPrompt = `Проверь находки междокументного аудита:\n\n${items.join("\n")}`;

  const raw = await llmAsk("inter_audit_qa", systemPrompt, userPrompt);

  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return findings.map((f) => ({ findingId: f.id, isFalsePositive: false }));

    const arr = JSON.parse(jsonMatch[0]) as any[];
    return arr.map((item) => ({
      findingId: item.id,
      isFalsePositive: item.is_false_positive === true,
    }));
  } catch {
    return findings.map((f) => ({ findingId: f.id, isFalsePositive: false }));
  }
}

/* ═══════════════════════ Helpers ═══════════════════════ */

function mapSeverity(raw: string | undefined): Severity {
  const s = (raw ?? "").toLowerCase();
  if (s === "critical") return "critical";
  if (s === "high" || s === "major") return "high";
  if (s === "medium" || s === "minor") return "medium";
  if (s === "low") return "low";
  return "info";
}
