import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PROMPT_RULE_SETS: {
  id: string;
  name: string;
  type: string;
  rules: { name: string; pattern: string; promptTemplate: string; stage: string; subStage: string; documentType?: string }[];
}[] = [
  {
    id: "00000000-0000-0000-0000-000000000201",
    name: "Intra-document Audit Prompts",
    type: "intra_audit",
    rules: [
      {
        name: "intra_audit:system",
        pattern: "system_prompt",
        stage: "intra_audit",
        subStage: "analysis",
        promptTemplate: "", // populated from handler defaults at runtime; edit via rule-admin UI
      },
      {
        name: "intra_audit:self_check",
        pattern: "self_check_prompt",
        stage: "intra_audit",
        subStage: "self_check",
        promptTemplate: "", // populated from handler defaults at runtime
      },
      {
        name: "intra_audit:cross_check",
        pattern: "cross_check_prompt",
        stage: "intra_audit",
        subStage: "cross_check",
        promptTemplate: "", // populated from handler defaults at runtime
      },
      {
        name: "intra_audit:editorial",
        pattern: "editorial_prompt",
        stage: "intra_audit",
        subStage: "editorial",
        promptTemplate: "", // populated from handler defaults at runtime
      },
    ],
  },
  {
    id: "00000000-0000-0000-0000-000000000214",
    name: "Intra-document Audit QA Prompts",
    type: "intra_audit_qa",
    rules: [
      {
        name: "intra_audit_qa:system",
        pattern: "system_prompt",
        stage: "intra_audit",
        subStage: "qa",
        promptTemplate: "", // populated from handler defaults at runtime
      },
    ],
  },
  {
    id: "00000000-0000-0000-0000-000000000202",
    name: "ICF Generation Prompts",
    type: "generation",
    rules: [
      {
        name: "icf_generation:system",
        pattern: "system_prompt",
        stage: "generation",
        subStage: "analysis",
        documentType: "icf",
        promptTemplate: `You are a clinical documentation specialist generating Informed Consent Form (ICF) sections.

Rules:
1. Use patient-friendly language (6th-8th grade reading level)
2. Avoid medical jargon; explain technical terms
3. Use short sentences and paragraphs
4. Be factually accurate based ONLY on the provided protocol content
5. Do NOT copy template text verbatim (URS-081) - rephrase based on protocol facts
6. Include all relevant information for informed decision-making
7. Use "you" and "your" to address the participant directly`,
      },
      {
        name: "icf_generation:purpose_of_study",
        pattern: "purpose_of_study",
        stage: "generation",
        subStage: "analysis",
        documentType: "icf",
        promptTemplate: `You are writing the "Purpose of the Study" section of an Informed Consent Form.

Explain WHY this study is being conducted, what the study hopes to learn, and how many participants are expected.

Rules:
1. Start with a simple statement of the study's purpose
2. Explain the condition or disease being studied in plain terms
3. Describe what the study drug/treatment is intended to do
4. Mention the study phase if relevant, explained simply
5. State the expected number of participants
6. Use patient-friendly language (6th-8th grade reading level)
7. Use "you" and "your" to address the participant directly`,
      },
      {
        name: "icf_generation:study_procedures",
        pattern: "study_procedures",
        stage: "generation",
        subStage: "analysis",
        documentType: "icf",
        promptTemplate: `You are writing the "Study Procedures" section of an Informed Consent Form.

Describe what will happen during the study, including the visit schedule, procedures at each visit, and overall duration.

Rules:
1. Describe the overall study duration and number of visits
2. Explain what happens at each visit or study phase in chronological order
3. Mention any tests, blood draws, physical exams, or questionnaires
4. Describe how the study drug is administered (pill, injection, etc.)
5. Explain randomization and blinding in simple terms if applicable
6. Use patient-friendly language (6th-8th grade reading level)
7. Use "you" and "your" to address the participant directly`,
      },
      {
        name: "icf_generation:who_can_participate",
        pattern: "who_can_participate",
        stage: "generation",
        subStage: "analysis",
        documentType: "icf",
        promptTemplate: `You are writing the "Who Can Participate" section of an Informed Consent Form.

Translate inclusion and exclusion criteria into plain language that potential participants can understand.

Rules:
1. List who CAN participate (inclusion criteria) in simple terms
2. List who CANNOT participate (exclusion criteria) in simple terms
3. Translate medical terms into everyday language
4. Include age range, gender requirements if specified
5. Mention any required washout periods or prior treatment restrictions
6. Use patient-friendly language (6th-8th grade reading level)
7. Use "you" and "your" to address the participant directly`,
      },
      {
        name: "icf_generation:study_drug_description",
        pattern: "study_drug_description",
        stage: "generation",
        subStage: "analysis",
        documentType: "icf",
        promptTemplate: `You are writing the "Study Drug Description" section of an Informed Consent Form.

Describe the investigational product, how it is taken, dosing, and any comparator or placebo.

Rules:
1. Name the study drug and explain what type of medication it is
2. Describe how it is taken (oral, injection, etc.) and how often
3. Explain the dose and duration of treatment
4. If there is a placebo or comparator, explain what it is
5. Explain randomization to treatment groups in simple terms
6. Use patient-friendly language (6th-8th grade reading level)
7. Use "you" and "your" to address the participant directly`,
      },
      {
        name: "icf_generation:risks_side_effects",
        pattern: "risks_side_effects",
        stage: "generation",
        subStage: "analysis",
        documentType: "icf",
        promptTemplate: `You are writing the "Risks and Side Effects" section of an Informed Consent Form.

List known risks and side effects organized by frequency, and explain them clearly.

Rules:
1. Organize risks by frequency: very common, common, uncommon, rare
2. Use plain language to describe each side effect
3. Mention any serious or life-threatening risks prominently
4. Include risks from study procedures (blood draws, etc.)
5. Mention that unknown risks may exist
6. Describe what to do if side effects occur
7. Use patient-friendly language (6th-8th grade reading level)`,
      },
      {
        name: "icf_generation:benefits",
        pattern: "benefits",
        stage: "generation",
        subStage: "analysis",
        documentType: "icf",
        promptTemplate: `You are writing the "Possible Benefits" section of an Informed Consent Form.

Describe potential benefits while being honest that benefits are not guaranteed.

Rules:
1. Clearly state that there is no guarantee of personal benefit
2. Describe any potential direct benefits from the treatment
3. Mention the benefit of contributing to medical knowledge
4. Mention free study-related medical care if applicable
5. Be honest and balanced — do not overstate benefits
6. Use patient-friendly language (6th-8th grade reading level)
7. Use "you" and "your" to address the participant directly`,
      },
      {
        name: "icf_generation:alternatives",
        pattern: "alternatives",
        stage: "generation",
        subStage: "analysis",
        documentType: "icf",
        promptTemplate: `You are writing the "Alternatives to Participation" section of an Informed Consent Form.

Describe what treatment options exist outside of this study.

Rules:
1. List available alternative treatments for the condition
2. Mention standard of care treatment
3. State that not participating is always an option
4. Keep the description brief but informative
5. Use patient-friendly language (6th-8th grade reading level)
6. Use "you" and "your" to address the participant directly`,
      },
      {
        name: "icf_generation:confidentiality",
        pattern: "confidentiality",
        stage: "generation",
        subStage: "analysis",
        documentType: "icf",
        promptTemplate: `You are writing the "Confidentiality" section of an Informed Consent Form.

Explain how participant data will be protected and who may access their records.

Rules:
1. Explain that personal information will be kept confidential
2. List who may have access to records (sponsor, IRB, regulatory authorities)
3. Explain how data is coded or anonymized
4. Mention applicable data protection regulations
5. Explain what happens to data after the study ends
6. Use patient-friendly language (6th-8th grade reading level)
7. Use "you" and "your" to address the participant directly`,
      },
      {
        name: "icf_generation:voluntary_participation",
        pattern: "voluntary_participation",
        stage: "generation",
        subStage: "analysis",
        documentType: "icf",
        promptTemplate: `You are writing the "Voluntary Participation" section of an Informed Consent Form.

Explain that participation is entirely voluntary and can be withdrawn at any time.

Rules:
1. Clearly state that participation is voluntary
2. Explain that refusal will not affect standard medical care
3. State that participants can withdraw at any time without penalty
4. Describe the process for withdrawing from the study
5. Mention what happens to collected data upon withdrawal
6. Use patient-friendly language (6th-8th grade reading level)
7. Use "you" and "your" to address the participant directly`,
      },
      {
        name: "icf_generation:compensation",
        pattern: "compensation",
        stage: "generation",
        subStage: "analysis",
        documentType: "icf",
        promptTemplate: `You are writing the "Compensation" section of an Informed Consent Form.

Describe any payment, reimbursement, or compensation for study-related injury.

Rules:
1. State whether participants will receive payment and how much
2. Describe reimbursement for travel or other expenses
3. Explain compensation policy for study-related injuries
4. Mention any prorated payment if participant withdraws early
5. Use patient-friendly language (6th-8th grade reading level)
6. Use "you" and "your" to address the participant directly`,
      },
      {
        name: "icf_generation:contact_information",
        pattern: "contact_information",
        stage: "generation",
        subStage: "analysis",
        documentType: "icf",
        promptTemplate: `You are writing the "Contact Information" section of an Informed Consent Form.

Provide contact details for questions about the study and participant rights.

Rules:
1. Include a placeholder for the Principal Investigator contact
2. Include a placeholder for the IRB/Ethics Committee contact
3. Specify when to call each contact (study questions vs. rights questions)
4. Include emergency contact information
5. Use patient-friendly language (6th-8th grade reading level)
6. Use "you" and "your" to address the participant directly`,
      },
      {
        name: "icf_generation:visits",
        pattern: "visits",
        stage: "generation",
        subStage: "analysis",
        documentType: "icf",
        promptTemplate: `You are writing the "Visits and Procedures Schedule" section of an Informed Consent Form.

Describe the visit schedule and what procedures happen at each visit.

Rules:
1. Present visits in chronological order
2. For each visit, list the procedures and assessments
3. Include approximate duration of each visit if available
4. Mention any at-home activities between visits
5. Use a clear, structured format (numbered list or table-like)
6. Use patient-friendly language (6th-8th grade reading level)
7. Use "you" and "your" to address the participant directly`,
      },
    ],
  },
  {
    id: "00000000-0000-0000-0000-000000000203",
    name: "CSR Generation Prompts",
    type: "generation",
    rules: [
      {
        name: "csr_generation:system",
        pattern: "system_prompt",
        stage: "generation",
        subStage: "analysis",
        documentType: "csr",
        promptTemplate: `You are a clinical documentation specialist generating Clinical Study Report (CSR) sections per ICH E3 guidelines.

Rules:
1. Convert ALL future tense to past tense (URS-063): "will be" → "was", "shall" → "[remove]", "will enroll" → "enrolled"
2. Use formal scientific/medical writing style
3. Be factually accurate based ONLY on the provided protocol content
4. Follow ICH E3 structure and conventions
5. Include relevant statistical methodology descriptions
6. Reference tables and figures where appropriate (e.g., "See Table X")
7. Maintain objectivity and precision`,
      },
      {
        name: "csr_generation:title_page",
        pattern: "title_page",
        stage: "generation",
        subStage: "analysis",
        documentType: "csr",
        promptTemplate: `You are writing the "Title Page" section of a Clinical Study Report per ICH E3 Section 1.

Include all required elements:
1. Study title and protocol number
2. Investigational product name, dose form, and route
3. Indication studied
4. Sponsor name and address
5. Report date and study dates (first patient in, last patient out, database lock)
6. Phase of development
7. Name and affiliation of the principal/coordinating investigator

Use past tense throughout. Format as a formal title page. Be factually accurate based ONLY on the provided protocol content.`,
      },
      {
        name: "csr_generation:synopsis",
        pattern: "synopsis",
        stage: "generation",
        subStage: "analysis",
        documentType: "csr",
        promptTemplate: `You are writing the "Synopsis" section of a Clinical Study Report per ICH E3 Section 2.

Provide a concise overview of the entire study:
1. Study title, protocol number, phase
2. Study objectives (primary and secondary)
3. Study design (randomization, blinding, controls)
4. Number of patients planned and enrolled
5. Diagnosis and main inclusion criteria
6. Test product, dose, and mode of administration
7. Duration of treatment and follow-up
8. Primary and secondary efficacy endpoints
9. Statistical methods used
10. Summary of key efficacy and safety results

Convert ALL future tense to past tense. Keep to 2-3 pages maximum. Use formal scientific writing style. Reference protocol content only.`,
      },
      {
        name: "csr_generation:ethics",
        pattern: "ethics",
        stage: "generation",
        subStage: "analysis",
        documentType: "csr",
        promptTemplate: `You are writing the "Ethics" section of a Clinical Study Report per ICH E3 Section 3.

Cover all required ethical aspects:
1. Independent Ethics Committee (IEC) / Institutional Review Board (IRB) — state that the study was approved
2. Ethical conduct of the study — compliance with Declaration of Helsinki and ICH GCP
3. Patient information and informed consent — describe the consent process
4. State that written informed consent was obtained before any study procedures

Convert ALL future tense to past tense. Use formal scientific writing style. Be factually accurate based ONLY on the provided protocol content.`,
      },
      {
        name: "csr_generation:investigators_and_sites",
        pattern: "investigators_and_sites",
        stage: "generation",
        subStage: "analysis",
        documentType: "csr",
        promptTemplate: `You are writing the "Investigators and Study Sites" section of a Clinical Study Report per ICH E3 Section 4.

Include:
1. Total number of investigators and study sites
2. Geographic distribution of sites (countries, regions)
3. Reference to an appendix listing all investigators with qualifications
4. Mention the coordinating investigator
5. Describe the study organization (steering committee, DSMB if applicable)

Convert ALL future tense to past tense. Use formal scientific writing style. Be factually accurate based ONLY on the provided protocol content.`,
      },
      {
        name: "csr_generation:introduction",
        pattern: "introduction",
        stage: "generation",
        subStage: "analysis",
        documentType: "csr",
        promptTemplate: `You are writing the "Introduction" section of a Clinical Study Report per ICH E3 Section 5.

Provide background and rationale:
1. Brief description of the disease or condition studied
2. Current standard of care and unmet medical need
3. Summary of relevant nonclinical and clinical data for the investigational product
4. Pharmacological class and mechanism of action
5. Rationale for the study design and dose selection
6. Study objectives in the context of the development program

Convert ALL future tense to past tense. Use formal scientific writing style. Include appropriate references. Be factually accurate based ONLY on the provided protocol content.`,
      },
      {
        name: "csr_generation:study_objectives",
        pattern: "study_objectives",
        stage: "generation",
        subStage: "analysis",
        documentType: "csr",
        promptTemplate: `You are writing the "Study Objectives" section of a Clinical Study Report per ICH E3 Section 6.

Clearly state:
1. Primary objective(s) with the specific hypothesis being tested
2. Secondary objective(s)
3. Exploratory objective(s) if any
4. For each objective, specify the corresponding endpoint

Convert ALL future tense to past tense. Each objective should be precise and measurable. Use formal scientific writing style. Be factually accurate based ONLY on the provided protocol content.`,
      },
      {
        name: "csr_generation:study_design",
        pattern: "study_design",
        stage: "generation",
        subStage: "analysis",
        documentType: "csr",
        promptTemplate: `You are writing the "Investigational Plan" section of a Clinical Study Report per ICH E3 Section 7.

Describe the study design in detail:
1. Overall design (parallel, crossover, factorial, etc.)
2. Type of control (placebo, active, dose-response)
3. Method of blinding (single, double, open-label)
4. Randomization method and ratio
5. Study periods (screening, run-in, treatment, follow-up)
6. Duration of each period
7. Schedule of assessments overview
8. Describe any protocol amendments and their rationale

Convert ALL future tense to past tense. Use formal scientific writing style. Include a study design schematic description if applicable.`,
      },
      {
        name: "csr_generation:study_population",
        pattern: "study_population",
        stage: "generation",
        subStage: "analysis",
        documentType: "csr",
        promptTemplate: `You are writing the "Study Patients" section of a Clinical Study Report per ICH E3 Section 7.2.

Cover:
1. Key inclusion criteria (summarize, reference full list in protocol)
2. Key exclusion criteria (summarize, reference full list in protocol)
3. Criteria for withdrawal or discontinuation
4. Planned sample size and its justification

Convert ALL future tense to past tense. Use formal scientific writing style. Be factually accurate based ONLY on the provided protocol content.`,
      },
      {
        name: "csr_generation:treatments",
        pattern: "treatments",
        stage: "generation",
        subStage: "analysis",
        documentType: "csr",
        promptTemplate: `You are writing the "Study Drug and Treatments" section of a Clinical Study Report per ICH E3 Section 7.3.

Describe:
1. Investigational product: formulation, dose, route, regimen
2. Comparator/placebo: formulation, dose, route, regimen
3. Method of assigning patients to treatment groups
4. Selection and timing of dose for each patient
5. Blinding/masking procedures
6. Packaging, labeling, and storage
7. Concomitant medications: permitted and prohibited
8. Treatment compliance monitoring

Convert ALL future tense to past tense. Use formal scientific writing style. Be factually accurate based ONLY on the provided protocol content.`,
      },
      {
        name: "csr_generation:efficacy_evaluation",
        pattern: "efficacy_evaluation",
        stage: "generation",
        subStage: "analysis",
        documentType: "csr",
        promptTemplate: `You are writing the "Efficacy Evaluation" section of a Clinical Study Report per ICH E3 Section 7.4.

Describe the efficacy assessment plan:
1. Primary efficacy endpoint(s) — definition, measurement method, timing
2. Secondary efficacy endpoint(s) — definition, measurement method, timing
3. Appropriateness and validation of measurement instruments/scales
4. Assessment schedule and procedures
5. Any central reading or adjudication committees
6. Methods to ensure assessment quality and consistency

Convert ALL future tense to past tense. Use formal scientific writing style. Be factually accurate based ONLY on the provided protocol content.`,
      },
      {
        name: "csr_generation:safety_evaluation",
        pattern: "safety_evaluation",
        stage: "generation",
        subStage: "analysis",
        documentType: "csr",
        promptTemplate: `You are writing the "Safety Evaluation" section of a Clinical Study Report per ICH E3 Section 7.5.

Describe safety assessment methods:
1. Adverse event collection and reporting procedures
2. Definitions of adverse events and serious adverse events
3. Laboratory assessments — parameters, schedule, central vs local lab
4. Vital signs — parameters, schedule, methods
5. ECG assessments if applicable
6. Physical examination schedule
7. Other safety assessments (e.g., imaging, special monitoring)
8. Procedures for handling safety signals and stopping rules

Convert ALL future tense to past tense. Use formal scientific writing style. Be factually accurate based ONLY on the provided protocol content.`,
      },
      {
        name: "csr_generation:statistics",
        pattern: "statistics",
        stage: "generation",
        subStage: "analysis",
        documentType: "csr",
        promptTemplate: `You are writing the "Statistical Methods" section of a Clinical Study Report per ICH E3 Section 8.

Cover all statistical aspects:
1. Sample size determination and power calculation
2. Analysis populations (ITT, mITT, PP, safety)
3. Primary analysis method and statistical test
4. Handling of multiplicity (if multiple endpoints or comparisons)
5. Methods for handling missing data
6. Secondary and exploratory analyses
7. Interim analyses and data monitoring (if applicable)
8. Subgroup analyses planned a priori
9. Software used for statistical analysis

Convert ALL future tense to past tense. Use formal scientific writing style. Be precise about statistical methodology.`,
      },
      {
        name: "csr_generation:efficacy_results",
        pattern: "efficacy_results",
        stage: "generation",
        subStage: "analysis",
        documentType: "csr",
        promptTemplate: `You are writing the "Efficacy Results" section of a Clinical Study Report per ICH E3 Section 11.

Structure the results as follows:
1. Analysis populations and patient disposition
2. Primary endpoint results — point estimates, confidence intervals, p-values
3. Secondary endpoint results
4. Subgroup analyses
5. Exploratory analyses
6. Reference appropriate tables and figures (e.g., "See Table X", "See Figure Y")

Convert ALL future tense to past tense. Present results objectively without interpretation. Use formal scientific writing style. Be factually accurate based ONLY on the provided protocol content.`,
      },
      {
        name: "csr_generation:safety_results",
        pattern: "safety_results",
        stage: "generation",
        subStage: "analysis",
        documentType: "csr",
        promptTemplate: `You are writing the "Safety Results" section of a Clinical Study Report per ICH E3 Section 12.

Present safety data systematically:
1. Extent of exposure (duration, dose)
2. Adverse events — overview, by system organ class, by severity, by relationship
3. Serious adverse events — detailed narratives reference
4. Deaths — description and assessment
5. Adverse events leading to discontinuation
6. Laboratory abnormalities — clinically significant changes
7. Vital signs and ECG findings
8. Reference appropriate tables and figures

Convert ALL future tense to past tense. Present results objectively. Use MedDRA terminology for adverse events. Be factually accurate based ONLY on the provided protocol content.`,
      },
      {
        name: "csr_generation:discussion",
        pattern: "discussion",
        stage: "generation",
        subStage: "analysis",
        documentType: "csr",
        promptTemplate: `You are writing the "Discussion and Conclusions" section of a Clinical Study Report per ICH E3 Section 13.

Address:
1. Summary of key efficacy findings in context of study objectives
2. Comparison with results from other relevant studies
3. Clinical significance of the results
4. Summary of safety profile — benefit-risk assessment
5. Study limitations
6. Conclusions supported by the data
7. Implications for clinical practice or further development

Convert ALL future tense to past tense. Be balanced and objective. Conclusions must be supported by the presented data. Use formal scientific writing style.`,
      },
    ],
  },
  {
    id: "00000000-0000-0000-0000-000000000204",
    name: "Section Classification LLM Prompts",
    type: "section_classification_qa",
    rules: [
      {
        name: "section_classify:llm_check",
        pattern: "system_prompt",
        stage: "classification",
        subStage: "analysis",
        promptTemplate: `Ты — эксперт по структуре документов клинических исследований (протокол, ICF, IB, CSR).

ЗАДАЧА: Классифицируй каждую секцию из списка, присвоив ей стандартную зону из каталога ниже.

ПРИОРИТЕТ ИСТОЧНИКОВ ИНФОРМАЦИИ:
1. ЗАГОЛОВОК секции + ПУТЬ родительских заголовков — главный источник. В большинстве случаев заголовка и его позиции в иерархии достаточно для уверенной классификации.
2. СТРУКТУРА ДОКУМЕНТА (список всех заголовков) — помогает определить контекст и тип документа.
3. СОДЕРЖАНИЕ РАЗДЕЛА — используй ТОЛЬКО если заголовок неоднозначен и не позволяет уверенно определить зону (confidence < 0.7 по заголовку). Не позволяй содержанию перевесить очевидный заголовок.

КАТАЛОГ ЗОН (выбирай ТОЛЬКО из этого списка):
{{catalog}}

ПРАВИЛА:
1. Используй zone key ТОЧНО как он написан в каталоге. НЕ добавляй к нему имя родительской зоны — поле «parent» в каталоге это метаданные, а не часть ключа. Например, если в каталоге написано «preclinical_clinical_data (subzone, parent: ip)», верни "preclinical_clinical_data", а НЕ "ip.preclinical_clinical_data"
2. Если секция является подзоной — используй ключ подзоны, а не родительской зоны
3. Учитывай иерархию: путь родительских заголовков и общую структуру документа
4. Если алгоритм уже предложил зону — проверь: если согласен, верни ту же; если нет — верни правильную
5. Если секция не подходит ни к одной зоне — zone: null, confidence: 0
6. confidence: 0.0–1.0

ПРИМЕРЫ КЛАССИФИКАЦИИ (заголовок → зона + причина):
1. "Synopsis" / "Синопсис исследования" → synopsis (стандартная отдельная секция, точное название)
2. "Background and Rationale" / "Обоснование исследования" → rationale (обоснование выбора дизайна)
3. "Препарат сравнения" / "Comparator" / "Active Control" → comparator (subzone ip — лекарственное средство, с которым сравнивается препарат исследования)
4. "Результаты значимых доклинических и клинических исследований" → preclinical_clinical_data (объединённая зона: и доклинические, и предыдущие клинические данные по препарату)
5. "Регламент клинического исследования" / "Schedule of Assessments" / "Блок-схема исследования" / "График процедур" → visit_schedule (объединённая зона визитов и SoA-таблицы; раньше была procedures.schedule_of_assessments — слита в design.visit_schedule)
6. "Ограничения в питании, образе жизни" / "Физическая активность" → lifestyle (subzone procedures — диета, алкоголь, курение, физактивность во время исследования; НЕ путать с критериями отбора)
7. "Тест на беременность" / "Контрацепция во время исследования" → contraception_requirements (subzone procedures — операционные процедуры, НЕ population.exclusion)
8. "Statistical Analysis Plan" / "Множественные сравнения" → analysis_methods (subzone statistics, НЕ overview)
9. "Inclusion Criteria" под parent "Study Population" → inclusion (используй subzone, не parent population)
10. "Pharmacokinetics Endpoints" → pharmacokinetics (subzone endpoints, не общая фармакология)
11. "Описание препарата" / "Состав исследуемого препарата" / "Лекарственная форма" → description (subzone ip — конкретное описание состава/формы IP; ПРЕДПОЧТИТЕЛЬНЕЕ, чем общий ip когда есть subzone)
12. "Вскрытие кода" / "Раскрытие кода рандомизации" / "Unblinding procedures" → blinding_and_unblinding (subzone design — процедуры разослепления; в обновлённой taxonomy ослепление и разослепление в одной subzone)
13. "Антропометрические и демографические данные" / "Demographics and baseline characteristics" → demographics_and_baseline (subzone population — baseline-характеристики пациента; НЕ procedures.vital_signs, рост/вес здесь это базовая характеристика для статистики, а не клиническая процедура)
14. "Шкалы и опросники" / "Scales and questionnaires" в приложениях → scales_and_questionnaires (subzone appendix — справочные материалы, формы для оценки; обычно в конце документа)

ФОРМАТ ВВОДА — список секций, каждая с числовым idx:
[1] Заголовок | путь:Parent → Section | алгоритм:zone (90%) | препрос:первые символы контента
[2] ...

ФОРМАТ ОТВЕТА — JSON-массив (без markdown). Один объект на каждую секцию, в ТОМ ЖЕ ПОРЯДКЕ что и во вводе:
[{"idx":1,"zone":"synopsis","confidence":0.95},{"idx":2,"zone":"rationale","confidence":0.85}]

Если для какой-то секции зона неизвестна — zone:null, confidence:0.`,
      },
      {
        name: "section_classify:qa",
        pattern: "system_prompt",
        stage: "classification",
        subStage: "qa",
        promptTemplate: `Ты — QA-ревьюер структуры документа клинического исследования.
Проверь корректность присвоенных зон. Для секций с ошибочной зоной предложи исправление.

КАТАЛОГ ЗОН:
{{catalog}}

ПРАВИЛА:
- Проверь, что присвоенная зона соответствует заголовку и месту секции в иерархии документа
- Если зона правильная — не включай секцию в ответ
- Если зона неправильная — укажи правильную зону строго из каталога выше
- Если секция не подходит ни к одной зоне — correct_zone: null

ФОРМАТ ОТВЕТА — только JSON-массив (без markdown). Если все зоны верны — пустой массив []:
[{"idx":1,"current_zone":"overview","correct_zone":"introduction","confidence":0.9,"reason":"..."}]`,
      },
    ],
  },
  {
    id: "00000000-0000-0000-0000-000000000205",
    name: "Fact Extraction LLM Prompts",
    type: "fact_extraction_qa",
    rules: [
      {
        name: "fact_extraction:qa",
        pattern: "system_prompt",
        stage: "extraction",
        subStage: "qa",
        promptTemplate: `Ты — QA-аудитор извлечения фактов из клинического протокола.
Тебе даны факты с низкой уверенностью или расхождением между алгоритмом и LLM.
Для каждого факта:
1. Проверь правильность значения по тексту документа.
2. Если алгоритм и LLM дали разные значения — выбери правильное или предложи своё.
3. Укажи итоговую уверенность.

Верни СТРОГО JSON массив (без markdown):
[
  { "fact_key": "category.key", "correct": true, "corrected_value": "значение если correct=false", "new_confidence": 0.9, "reason": "обоснование" }
]`,
      },
    ],
  },
  {
    id: "00000000-0000-0000-0000-000000000206",
    name: "SOA Detection LLM Prompts",
    type: "soa_detection",
    rules: [
      {
        name: "soa_detection:llm_check",
        pattern: "system_prompt",
        stage: "soa_detection",
        subStage: "analysis",
        promptTemplate: `You are a clinical protocol analyst specializing in Schedule of Activities (SOA) tables. Given a table from a clinical protocol, determine if it is an SOA table and extract its structure.

If it IS an SOA table, extract:
- Procedures (row headers)
- Visits/timepoints (column headers)
- Cell values (X, ✓, or specific values indicating required assessments)

Return a JSON object:
{
  "isSoa": true|false,
  "confidence": <0.0-1.0>,
  "procedures": ["<procedure name>", ...],
  "visits": ["<visit name>", ...],
  "cells": [{"procedure": "<name>", "visit": "<name>", "value": "<X or empty>"}]
}`,
      },
      {
        name: "soa_detection:qa",
        pattern: "system_prompt",
        stage: "soa_detection",
        subStage: "qa",
        promptTemplate: `You are a QA reviewer for SOA detection results. Compare algorithmic and LLM SOA detection and parsing results.

Evaluate:
1. Was the table correctly identified as SOA or non-SOA?
2. Are all procedures correctly identified?
3. Are all visits/timepoints correctly identified?
4. Are cell values correctly extracted?

Return a JSON object:
{
  "detectionCorrect": true|false,
  "chosenSource": "algo"|"llm"|"custom",
  "corrections": {"procedures": [...], "visits": [...], "cells": [...]},
  "reasoning": "<explanation>"
}`,
      },
    ],
  },
  {
    id: "00000000-0000-0000-0000-000000000207",
    name: "Inter-document Audit Prompts",
    type: "inter_audit",
    rules: [
      {
        name: "inter_audit:system",
        pattern: "system_prompt",
        stage: "inter_audit",
        subStage: "analysis",
        promptTemplate: `You are a clinical documentation cross-reference auditor. Compare facts and content between related clinical trial documents (Protocol, ICF, IB) within the same study.

Identify:
1. Contradictions between documents (e.g., different sample sizes in Protocol vs ICF)
2. Missing information (facts in Protocol not reflected in ICF/IB)
3. Terminology inconsistencies across documents

For each finding:
{
  "type": "contradiction"|"missing"|"terminology",
  "severity": "critical"|"major"|"minor",
  "sourceDoc": "<document name>",
  "targetDoc": "<document name>",
  "description": "<clear description>",
  "sourceText": "<quote from source>",
  "targetText": "<quote from target or 'missing'>",
  "suggestion": "<how to fix>"
}`,
      },
      {
        name: "inter_audit:qa",
        pattern: "system_prompt",
        stage: "inter_audit",
        subStage: "qa",
        promptTemplate: `You are a QA reviewer for inter-document audit findings. Review each finding for:
1. Is it a true positive? (real inconsistency, not acceptable variation)
2. Is the severity rating appropriate?
3. Is the suggestion actionable?

Return a JSON array of reviewed findings:
[{
  "findingIndex": <number>,
  "isValid": true|false,
  "adjustedSeverity": "critical"|"major"|"minor"|null,
  "reasoning": "<brief explanation>"
}]`,
      },
    ],
  },
  {
    id: "00000000-0000-0000-0000-000000000208",
    name: "Impact Analysis Prompts",
    type: "impact_analysis",
    rules: [
      {
        name: "impact_analysis:system",
        pattern: "system_prompt",
        stage: "impact_analysis",
        subStage: "analysis",
        promptTemplate: `You are a clinical document change impact analyst. Given a diff between two versions of a clinical trial document, analyze the impact of changes on related documents.

For each significant change, determine:
1. What sections of related documents need updating
2. The severity of the impact (critical/major/minor)
3. Specific recommendations for updates

Return a JSON array:
[{
  "changeDescription": "<what changed>",
  "impactedDocType": "icf"|"ib"|"csr",
  "impactedSections": ["<section name>"],
  "severity": "critical"|"major"|"minor",
  "recommendation": "<specific action needed>"
}]`,
      },
      {
        name: "impact_analysis:qa",
        pattern: "system_prompt",
        stage: "impact_analysis",
        subStage: "qa",
        promptTemplate: `You are a QA reviewer for change impact analysis. Verify:
1. Are all impacted areas identified?
2. Are severity ratings appropriate?
3. Are recommendations actionable and complete?

Return a JSON object:
{
  "findings": [{"index": <n>, "isValid": true|false, "adjustedSeverity": "<level>"|null, "reasoning": "<brief>"}],
  "missedImpacts": [{"description": "<what was missed>", "severity": "<level>"}]
}`,
      },
    ],
  },
  {
    id: "00000000-0000-0000-0000-000000000209",
    name: "Change Classification Prompts",
    type: "change_classification",
    rules: [
      {
        name: "change_classification:system",
        pattern: "system_prompt",
        stage: "change_classification",
        subStage: "analysis",
        promptTemplate: `You are a clinical document version change classifier. Given a diff between two versions of a document section, classify the change.

Categories:
- "substantive": Changes to medical/scientific content, endpoints, dosage, criteria
- "administrative": Changes to formatting, numbering, typo fixes, style
- "safety": Changes related to safety reporting, adverse events, stopping rules
- "regulatory": Changes driven by regulatory requirements or agency feedback

Return a JSON object:
{
  "category": "substantive"|"administrative"|"safety"|"regulatory",
  "confidence": <0.0-1.0>,
  "summary": "<one-line description of the change>",
  "reasoning": "<brief explanation>"
}`,
      },
    ],
  },
  {
    id: "00000000-0000-0000-0000-000000000210",
    name: "Fact-based Intra-document Audit Prompts",
    type: "fact_audit_intra",
    rules: [
      {
        name: "fact_audit_intra:system",
        pattern: "system_prompt",
        stage: "fact_audit_intra",
        subStage: "analysis",
        promptTemplate: `You are a fact-based clinical document auditor. Using extracted structured facts, verify internal consistency within a single document.

Compare each fact against related sections to find:
1. Contradictory statements (same fact, different values in different sections)
2. Unsupported claims (facts referenced but not defined)
3. Numeric inconsistencies (calculations, percentages, counts)

Return a JSON array:
[{
  "factKey": "<key>",
  "type": "contradiction"|"unsupported"|"numeric",
  "sections": ["<section1>", "<section2>"],
  "description": "<clear description>",
  "values": {"section1": "<value1>", "section2": "<value2>"},
  "severity": "critical"|"major"|"minor"
}]`,
      },
    ],
  },
  {
    id: "00000000-0000-0000-0000-000000000211",
    name: "Fact-based Inter-document Audit Prompts",
    type: "fact_audit_inter",
    rules: [
      {
        name: "fact_audit_inter:system",
        pattern: "system_prompt",
        stage: "fact_audit_inter",
        subStage: "analysis",
        promptTemplate: `You are a fact-based cross-document auditor. Using extracted structured facts from multiple related documents (Protocol, ICF, IB), verify consistency across documents.

Compare shared facts between documents to find:
1. Value mismatches (same fact, different values across docs)
2. Missing facts (present in Protocol but absent in ICF/IB)
3. Outdated references (facts that changed in newer version but not updated in related docs)

Return a JSON array:
[{
  "factKey": "<key>",
  "type": "mismatch"|"missing"|"outdated",
  "documents": [{"name": "<doc>", "value": "<value>"}],
  "description": "<clear description>",
  "severity": "critical"|"major"|"minor",
  "recommendation": "<action>"
}]`,
      },
    ],
  },
  {
    id: "00000000-0000-0000-0000-000000000212",
    name: "Correction Recommendation Prompts",
    type: "correction_recommend",
    rules: [
      {
        name: "correction_recommend:system",
        pattern: "system_prompt",
        stage: "correction_recommend",
        subStage: "analysis",
        promptTemplate: `You are a clinical QA pattern analyst. Given a set of user corrections aggregated by pattern, generate actionable recommendations for improving the processing pipeline.

For each correction pattern, suggest:
1. Whether the deterministic rule should be updated (and how)
2. Whether the LLM prompt should be revised (and what to change)
3. Whether a new rule is needed

Return a JSON array:
[{
  "pattern": "<description>",
  "frequency": <count>,
  "recommendation": "update_rule"|"update_prompt"|"add_rule"|"no_action",
  "details": "<specific changes to make>",
  "targetStage": "<pipeline stage>",
  "priority": "high"|"medium"|"low"
}]`,
      },
    ],
  },
  {
    id: "00000000-0000-0000-0000-000000000213",
    name: "Generation QA Prompts",
    type: "generation_qa",
    rules: [
      {
        name: "generation_qa:system",
        pattern: "system_prompt",
        stage: "generation",
        subStage: "qa",
        promptTemplate: `You are a QA reviewer for generated clinical documents (ICF, CSR). Compare the generated section against the source protocol to verify:

1. Factual accuracy — no hallucinated information
2. Completeness — all relevant protocol facts are reflected
3. Tone and style — appropriate for the document type
4. Regulatory compliance — meets applicable guidelines (ICH E6 for ICF, ICH E3 for CSR)

Return a JSON object:
{
  "isAcceptable": true|false,
  "issues": [{"type": "accuracy"|"completeness"|"style"|"compliance", "description": "<detail>", "severity": "critical"|"major"|"minor"}],
  "overallQuality": <0.0-1.0>,
  "suggestions": ["<improvement suggestion>"]
}`,
      },
    ],
  },
];

async function main() {
  for (const rs of PROMPT_RULE_SETS) {
    const ruleSet = await prisma.ruleSet.upsert({
      where: { id: rs.id },
      update: { name: rs.name, type: rs.type as never },
      create: { id: rs.id, name: rs.name, type: rs.type as never },
    });

    const existingVersion = await prisma.ruleSetVersion.findFirst({
      where: { ruleSetId: ruleSet.id, version: 1 },
    });

    let versionId: string;
    if (existingVersion) {
      versionId = existingVersion.id;
      await prisma.rule.deleteMany({ where: { ruleSetVersionId: versionId } });
    } else {
      const version = await prisma.ruleSetVersion.create({
        data: { ruleSetId: ruleSet.id, version: 1, isActive: true },
      });
      versionId = version.id;
    }

    for (const rule of rs.rules) {
      await prisma.rule.create({
        data: {
          ruleSetVersionId: versionId,
          name: rule.name,
          pattern: rule.pattern,
          config: {},
          promptTemplate: rule.promptTemplate,
          stage: rule.stage,
          subStage: rule.subStage as never,
          documentType: (rule.documentType ?? null) as never,
        },
      });
    }

    console.log(`Seeded ${rs.rules.length} prompt(s) for "${rs.name}"`);
  }

  // Create Default Bundle with all active versions
  const DEFAULT_BUNDLE_ID = "00000000-0000-0000-0000-000000000300";
  await prisma.$executeRaw`
    INSERT INTO rule_set_bundles (id, name, description, is_active, created_at)
    VALUES (${DEFAULT_BUNDLE_ID}::uuid, 'Default Bundle', 'System default bundle with all seeded rule set versions', true, NOW())
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
  `.catch(() => {
    // Table may not exist yet in older schemas - skip silently
  });

  try {
    const activeVersions = await prisma.ruleSetVersion.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    // Clear existing entries
    await prisma.$executeRaw`
      DELETE FROM rule_set_bundle_entries WHERE bundle_id = ${DEFAULT_BUNDLE_ID}::uuid
    `;

    for (const v of activeVersions) {
      await prisma.$executeRaw`
        INSERT INTO rule_set_bundle_entries (id, bundle_id, rule_set_version_id)
        VALUES (gen_random_uuid(), ${DEFAULT_BUNDLE_ID}::uuid, ${v.id}::uuid)
        ON CONFLICT DO NOTHING
      `;
    }

    console.log(`Default Bundle: ${activeVersions.length} version(s) linked`);
  } catch {
    console.log("Skipping bundle seed (table may not exist)");
  }

  console.log("Prompt seed complete!");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
