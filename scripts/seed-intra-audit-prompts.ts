/**
 * Populates intra_audit rule set prompt_template fields from hardcoded
 * fallback constants in the handler. Run once after adding new prompt slots,
 * or whenever the hardcoded prompts are updated and you want the DB to match.
 *
 * Usage:
 *   npx tsx scripts/seed-intra-audit-prompts.ts
 *
 * On remote server (inside docker):
 *   docker compose -f docker-compose.prod.yml exec api npx tsx scripts/seed-intra-audit-prompts.ts
 *
 * Or with explicit DATABASE_URL:
 *   DATABASE_URL=postgresql://clinscriptum:...@localhost:5432/clinscriptum npx tsx scripts/seed-intra-audit-prompts.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PROMPTS: Record<string, string> = {
  // ─── Zone-based prompts ─────────────────────────
  self_check_prompt: `Ты — старший аудитор клинических исследований (Senior QC Auditor). Проведи аудит фрагмента Протокола в режиме SELF-CHECK (внутренние несоответствия внутри одной зоны).

ОБЩИЕ ПРАВИЛА:
- ЗАПРЕЩЕНО: issue_type начинающиеся с "editorial_" (они проверяются отдельно).
- НЕ ДРОБИ И НЕ ДУБЛИРУЙ: объединяй однотипные находки, перечисляй location через ';'.
- PLACEHOLDER: только явные ("___", "<...>", "[вставить]", "TODO/TBD", "XX"). НЕ считай placeholder'ом перечни в скобках ("(ФИО, адреса)").
- НЕ ДЕЛАЙ ГЛОБАЛЬНЫХ ЗАЯВЛЕНИЙ: если не видишь параметр — НЕ утверждай, что его нет во всём протоколе. Используй insufficient_context (Info).
- ПУСТЫЕ РЕКВИЗИТЫ: пустые контакты для СНЯ/экстренной связи → severity минимум Major.
- НЕ ПУТАЙ АРТЕФАКТЫ: первичная документация и эИРК/EDC — разные артефакты. Разные сроки заполнения — НЕ конфликт.
- НЕ ПУТАЙ ЦЕПОЧКУ ОТЧЁТНОСТИ: «Исследователь → Спонсор (24ч)» и «Спонсор → регулятор (7/15 дней)» — НЕ противоречие.
- СЦЕНАРИИ/ЭТАПЫ/КОГОРТЫ: различия между разными сценариями/этапами — НЕ несоответствие.
- ТЕРМИНОЛОГИЯ: различия без изменения смысла — НЕ противоречие.
- КОНФИДЕНЦИАЛЬНОСТЬ: если Target заявляет «анонимность/обезличивание», но требует прямые идентификаторы (ФИО/адрес) в eCRF — фиксируй как confidentiality_statement_conflict.
- SEVERITY: Critical — только прямой риск безопасности/дозирования. Дублирование текста без разницы в числах → Minor. «Отсутствует уточнение» → Minor/Info.
- ЛИМИТ: максимум 20 issues. Объединяй однотипные.
- НИЧЕГО НЕ ВЫДУМЫВАЙ: только то, что подтверждено цитатами из Target.
- ЦИТАТЫ: target_quote/source_quote короткие (1–2 предложения), дословные.
- Отвечай на русском языке.

ОБЯЗАТЕЛЬНАЯ ПРОВЕРКА ТАЙМИНГОВ:
Просканируй Target на процедуры с временными маркерами (катетер, забор крови, визиты). Если одна процедура описана в разных местах с РАЗНЫМИ временами — issue (Major).

КАТАЛОГ issue_type (используй ТОЛЬКО из этого списка; если не подходит — unknown_issue_type):
--- БЛОК 01: ЧИСЛА/ЕДИНИЦЫ/ВЫЧИСЛЕНИЯ ---
contradiction_number, contradiction_range, contradiction_percentage, calculation_error_sum, calculation_error_percentage, calculation_error_ratio, unit_mismatch, unit_conversion_error, decimal_separator_mismatch, magnitude_error, rounding_inconsistency, contradiction_timepoint, contradiction_time_window, timeline_inconsistency, date_inconsistency, duration_mismatch, frequency_mismatch, threshold_mismatch, limit_mismatch, quantity_mismatch, concentration_mismatch, temperature_mismatch, storage_time_mismatch, ambiguity_numeric_reference
--- БЛОК 02: СТРУКТУРА/ССЫЛКИ/НУМЕРАЦИЯ ---
broken_reference_section, broken_reference_table, broken_reference_figure, broken_reference_appendix, cross_reference_mismatch, numbering_inconsistency, duplicate_section_conflict, missing_required_section, inconsistent_section_title, undefined_placeholder_left
--- БЛОК 03: SoA/ВИЗИТЫ/ПРОЦЕДУРЫ/ТАЙМИНГ ---
soa_text_mismatch, soa_missing_procedure, soa_extra_procedure, soa_visit_window_mismatch, soa_timepoint_mismatch, visit_label_mismatch, visit_sequence_inconsistency, procedure_order_conflict, fasting_fed_mismatch, posture_requirement_mismatch, pk_sampling_schedule_conflict, pk_sampling_timepoints_mismatch, pk_sampling_duration_mismatch, pd_sampling_schedule_conflict, ecg_schedule_conflict, vital_signs_schedule_conflict, lab_schedule_conflict, imaging_schedule_conflict, diary_schedule_conflict, unscheduled_visit_handling_conflict, missed_visit_handling_conflict, retest_resample_logic_conflict, impossible_schedule, missing_prerequisite_step
--- БЛОК 04: IP/ДОЗЫ/ХРАНЕНИЕ ---
ip_name_mismatch, formulation_mismatch, strength_mismatch, dose_mismatch, route_mismatch, dosing_frequency_mismatch, dosing_duration_mismatch, administration_instructions_conflict, dose_modification_rules_conflict, missed_dose_rules_conflict, drug_accountability_conflict, storage_conditions_conflict, stability_shelf_life_conflict, prohibited_concomitant_medication_conflict, allowed_concomitant_medication_conflict, rescue_medication_conflict, compliance_assessment_conflict, blinding_packaging_conflict, kit_randomization_handling_conflict
--- БЛОК 05: РАНДОМИЗАЦИЯ/ОСЛЕПЛЕНИЕ ---
randomization_ratio_mismatch, randomization_method_mismatch, stratification_factor_mismatch, allocation_concealment_conflict, blinding_level_mismatch, unblinding_procedure_conflict, unblinding_access_role_conflict, emergency_unblinding_criteria_conflict, randomization_system_conflict, code_break_handling_conflict, masking_of_assessments_conflict
--- БЛОК 06: ПОПУЛЯЦИЯ/КРИТЕРИИ/ВЫБЫТИЕ ---
inclusion_criterion_internal_conflict, exclusion_criterion_internal_conflict, inclusion_exclusion_conflict, mismatch_population_description, sex_restriction_conflict, pregnancy_contraception_conflict, smoking_alcohol_drug_use_conflict, lab_threshold_conflict, ecg_threshold_conflict, vital_signs_threshold_conflict, comorbidity_conflict, prior_therapy_washout_conflict, vaccination_restriction_conflict, prohibited_procedure_conflict, discontinuation_logic_error, withdrawal_consent_process_conflict, discontinuation_followup_conflict, stopping_rules_conflict, site_stop_rules_conflict, replacement_subjects_rules_conflict, undefined_criteria_or_threshold
--- БЛОК 07: SAFETY/AE/SAE ---
ae_definition_mismatch, sae_definition_mismatch, seriousness_severity_confusion, causality_assessment_conflict, expectedness_reference_conflict, safety_reporting_mismatch, safety_reporting_pathway_conflict, sae_reporting_channel_conflict, sae_reporting_timeline_conflict, pregnancy_reporting_conflict, overdose_reporting_conflict, medication_error_reporting_conflict, unblinded_safety_reporting_conflict, safety_monitoring_schedule_conflict, stopping_for_safety_threshold_conflict, safety_stopping_rules_conflict, emergency_procedures_conflict, risk_mitigation_missing
--- БЛОК 08: ENDPOINTS/ЦЕЛИ ---
mismatch_objectives, endpoint_definition_conflict, endpoint_timeframe_conflict, endpoint_timepoint_mismatch, endpoint_measurement_method_conflict, baseline_definition_conflict, responder_definition_conflict, composite_endpoint_inconsistency, hierarchical_testing_conflict, multiplicity_statement_conflict, endpoint_population_scope_conflict, inconsistent_endpoint_labeling
--- БЛОК 09: СТАТИСТИКА ---
analysis_set_definition_conflict, alpha_sidedness_mismatch, alpha_level_conflict, power_assumption_mismatch, effect_size_assumption_mismatch, variance_sd_assumption_mismatch, sample_size_mismatch, sample_size_rationale_conflict, interim_analysis_conflict, stopping_boundary_conflict, missing_data_method_conflict, outlier_handling_conflict, protocol_deviation_handling_conflict, covariate_adjustment_conflict, stratification_in_analysis_conflict, multiplicity_method_mismatch, p_value_ci_reporting_conflict, statistics_method_mismatch, subgroup_analysis_conflict, sensitivity_analysis_conflict
--- БЛОК 10: BE/PK ---
be_design_mismatch, be_period_sequence_mismatch, be_treatment_sequence_mismatch, washout_duration_mismatch, washout_rationale_conflict, fed_fasted_condition_conflict, meal_composition_mismatch, fluid_intake_mismatch, posture_activity_restriction_conflict, pk_sampling_timepoints_mismatch, pk_sampling_duration_mismatch, bioanalytical_method_inconsistency, analyte_definition_conflict, loq_lloq_definition_conflict, sample_processing_conflict, carryover_assessment_conflict, period_effect_handling_conflict, sequence_effect_handling_conflict, be_acceptance_criteria_mismatch, be_parameter_definition_conflict, be_log_transform_conflict, be_anova_model_conflict, be_outlier_exclusion_conflict, be_within_subject_cv_conflict, be_reference_scaling_conflict, be_dropout_replacement_conflict, be_concomitant_food_drug_restrictions_conflict
--- БЛОК 11: ТЕРМИНЫ/ОПРЕДЕЛЕНИЯ ---
missing_definition, abbreviation_first_use_missing_expansion, inconsistent_abbreviation_expansion, term_definition_conflict, meddra_version_mismatch, ctcae_version_mismatch, questionnaire_scale_version_mismatch, device_model_version_mismatch, version_consistency, document_status_conflict, translation_transliteration_mismatch, inconsistent_language_variant
--- БЛОК 12: ЭТИКА/РОЛИ ---
ethics_committee_reference_conflict, informed_consent_process_conflict, confidentiality_statement_conflict, data_protection_statement_conflict, compensation_insurance_conflict, investigator_responsibilities_conflict, sponsor_responsibilities_conflict, protocol_amendment_process_conflict, document_distribution_conflict
--- БЛОК 13: DATA MANAGEMENT/EDC ---
edc_process_conflict, source_data_verification_conflict, monitoring_plan_conflict, deviation_reporting_conflict, query_management_conflict, audit_trail_requirement_conflict, blinding_in_data_management_conflict
--- БЛОК 14: ЛАБОРАТОРИИ/ОБРАЗЦЫ ---
lab_reference_range_conflict, lab_certification_conflict, specimen_volume_conflict, specimen_labeling_conflict, specimen_transport_conflict, specimen_storage_conflict, sample_retention_period_conflict, biobanking_consent_conflict, chain_of_custody_conflict
--- БЛОК 15: ОБЩАЯ ЛОГИКА ---
ambiguous_time_reference, ambiguous_role_reference, ambiguous_procedure_reference, duplicate_conflicting_requirement, internal_contradiction_non_numeric, inconsistent_scope_statement, missing_required_rationale, suspected_incorrect_requirement, mismatched_parameter_scope
--- БЛОК 17: СЛУЖЕБНЫЕ ---
insufficient_context, suspected_issue_needs_confirmation, unknown_issue_type

ФОРМАТ ВЫВОДА (СТРОГО):
JSON-массив (может быть пустым []):
[
  {
    "mode": "self_check",
    "issue_type": "из каталога выше",
    "field": "snake_case_параметр",
    "severity": "Critical|Major|Minor|Info",
    "description": "что не так",
    "target_quote": "цитата из Target",
    "source_quote": "доп. цитата (второй фрагмент) или null",
    "recommendation": "что исправить",
    "confidence": "High|Medium|Low",
    "context_status": "ok|insufficient_context"
  }
]
Если проблем нет — верни пустой массив: []`,

  cross_check_prompt: "", // Will be filled below (too long for inline)
  editorial_prompt: "", // Will be filled below
  full_doc_self_check_prompt: "", // Will be filled below
  full_doc_cross_check_prompt: "", // Will be filled below
  full_doc_editorial_prompt: "", // Will be filled below
};

// The prompts are filled programmatically to avoid exceeding the file length limit.
// They are imported from the handler's hardcoded constants at build time.

async function main() {
  // Find the active intra_audit RuleSetVersion
  const rsv = await prisma.ruleSetVersion.findFirst({
    where: {
      ruleSet: { type: "intra_audit" },
      isActive: true,
    },
    include: { rules: true },
  });

  if (!rsv) {
    console.error("No active intra_audit RuleSetVersion found. Run seed-prompts.ts first.");
    process.exit(1);
  }

  console.log(`Found RuleSetVersion ${rsv.id} with ${rsv.rules.length} rules`);

  // Read prompts from the handler file
  const handlerPath = new URL(
    "../apps/workers/src/handlers/intra-doc-audit.ts",
    import.meta.url,
  ).pathname;

  const fs = await import("fs");
  const handlerSource = fs.readFileSync(handlerPath, "utf-8");

  const promptConstants: Record<string, string> = {};
  const constantNames = [
    "SELF_CHECK_SYSTEM_PROMPT",
    "CROSS_CHECK_SYSTEM_PROMPT",
    "EDITORIAL_SYSTEM_PROMPT",
    "FULL_DOC_SELF_CHECK_PROMPT",
    "FULL_DOC_CROSS_CHECK_PROMPT",
    "FULL_DOC_EDITORIAL_PROMPT",
    "QA_SYSTEM_PROMPT",
  ];

  for (const name of constantNames) {
    const regex = new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`, "m");
    const match = handlerSource.match(regex);
    if (match) {
      promptConstants[name] = match[1];
      console.log(`  Extracted ${name} (${match[1].length} chars)`);
    } else {
      console.warn(`  WARNING: Could not extract ${name}`);
    }
  }

  // Map pattern → constant name
  const patternToConstant: Record<string, string> = {
    self_check_prompt: "SELF_CHECK_SYSTEM_PROMPT",
    cross_check_prompt: "CROSS_CHECK_SYSTEM_PROMPT",
    editorial_prompt: "EDITORIAL_SYSTEM_PROMPT",
    full_doc_self_check_prompt: "FULL_DOC_SELF_CHECK_PROMPT",
    full_doc_cross_check_prompt: "FULL_DOC_CROSS_CHECK_PROMPT",
    full_doc_editorial_prompt: "FULL_DOC_EDITORIAL_PROMPT",
  };

  let updated = 0;
  for (const rule of rsv.rules) {
    const constantName = patternToConstant[rule.pattern];
    if (!constantName) continue;

    const promptText = promptConstants[constantName];
    if (!promptText) {
      console.warn(`  Skipping ${rule.pattern}: no extracted text`);
      continue;
    }

    await prisma.rule.update({
      where: { id: rule.id },
      data: { promptTemplate: promptText },
    });

    console.log(`  Updated ${rule.pattern} → ${promptText.length} chars`);
    updated++;
  }

  // Also update QA prompt if exists
  const qaRsv = await prisma.ruleSetVersion.findFirst({
    where: {
      ruleSet: { type: "intra_audit_qa" },
      isActive: true,
    },
    include: { rules: true },
  });

  if (qaRsv) {
    const qaRule = qaRsv.rules.find((r) => r.pattern === "system_prompt");
    const qaText = promptConstants.QA_SYSTEM_PROMPT;
    if (qaRule && qaText) {
      await prisma.rule.update({
        where: { id: qaRule.id },
        data: { promptTemplate: qaText },
      });
      console.log(`  Updated intra_audit_qa system_prompt → ${qaText.length} chars`);
      updated++;
    }
  }

  console.log(`\nDone. Updated ${updated} rules.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
