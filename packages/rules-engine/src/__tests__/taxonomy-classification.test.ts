import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { parse } from "yaml";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { SectionClassifier } from "../section-classifier.js";
import { toSectionMappingRules, type DbRule } from "../rule-adapter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface TaxonomyZone {
  canonical_zone: string;
  title_ru: string;
  patterns?: string[];
  require_patterns?: string[];
  not_keywords?: string[];
  children?: Record<string, {
    title_ru: string;
    patterns?: string[];
    require_patterns?: string[];
    not_keywords?: string[];
  }>;
}

/**
 * Mirror of `flattenTaxonomy` from packages/db/src/seed-taxonomy.ts so we can
 * load the live taxonomy.yaml and verify that confused-subzone titles from the
 * 2026-05-05 baseline (`baseline-clean.json`) classify into the expected
 * subzones, not parent zones.
 */
function loadTaxonomyAsRules(): DbRule[] {
  const taxonomyPath = resolve(__dirname, "../../../..", "taxonomy.yaml");
  const content = readFileSync(taxonomyPath, "utf-8");
  const taxonomy = parse(content) as Record<string, TaxonomyZone>;

  const rules: DbRule[] = [];
  for (const [zoneKey, zone] of Object.entries(taxonomy)) {
    rules.push({
      name: `zone:${zoneKey}`,
      pattern: zone.canonical_zone,
      config: {
        type: "zone",
        key: zoneKey,
        canonicalZone: zone.canonical_zone,
        titleRu: zone.title_ru,
        patterns: zone.patterns ?? [],
        requirePatterns: zone.require_patterns ?? [],
        notKeywords: zone.not_keywords ?? [],
      },
    });
    if (zone.children) {
      for (const [childKey, child] of Object.entries(zone.children)) {
        rules.push({
          name: `subzone:${zoneKey}.${childKey}`,
          pattern: `${zone.canonical_zone}.${childKey}`,
          config: {
            type: "subzone",
            key: childKey,
            parentZone: zoneKey,
            canonicalZone: zone.canonical_zone,
            titleRu: child.title_ru,
            patterns: child.patterns ?? [],
            requirePatterns: child.require_patterns ?? [],
            notKeywords: child.not_keywords ?? [],
          },
        });
      }
    }
  }
  return rules;
}

describe("taxonomy.yaml → SectionClassifier integration (Phase 2 subzone gap)", () => {
  const dbRules = loadTaxonomyAsRules();
  const mappingRules = toSectionMappingRules(dbRules);
  const classifier = new SectionClassifier(mappingRules);

  // Helper: classify with explicit parent-zone context (как делает classifyHierarchical
  // когда обрабатывает дочернюю секцию внутри родительской зоны).
  const cls = (title: string, parentZone?: string) =>
    classifier.classify(title, undefined, parentZone).standardSection;

  describe("safety.adverse_events.* subzone gap", () => {
    // Все эти titles должны классифицироваться в conkretnyy subzone (definitions/assessment/reporting),
    // а не оставаться на уровне parent `safety` или `safety.adverse_events`.
    // Тестируем БЕЗ parent context (худший случай) и С parent context "safety".

    it("'Нежелательное явление' → safety.adverse_events.definitions", () => {
      expect(cls("Нежелательное явление", "safety")).toBe("safety.adverse_events.definitions");
    });

    it("'Серьезные нежелательные явления' → safety.adverse_events.definitions", () => {
      expect(cls("Серьезные нежелательные явления", "safety")).toBe(
        "safety.adverse_events.definitions",
      );
    });

    it("'Определение и классификации' → safety.adverse_events.definitions", () => {
      expect(cls("Определение и классификации", "safety")).toBe(
        "safety.adverse_events.definitions",
      );
    });

    it("'Нежелательные явления, представляющие особый интерес' → definitions", () => {
      expect(cls("Нежелательные явления, представляющие особый интерес", "safety")).toBe(
        "safety.adverse_events.definitions",
      );
    });

    it("'Категории предпринятых действий и исход НЯ и СНЯ' → assessment", () => {
      expect(cls("Категории предпринятых действий и исход НЯ и СНЯ", "safety")).toBe(
        "safety.adverse_events.assessment",
      );
    });

    it("'Метод и продолжительность наблюдения за субъектами после возникновения НЯ' → assessment", () => {
      expect(
        cls("Метод и продолжительность наблюдения за субъектами после возникновения нежелательных явлений", "safety"),
      ).toBe("safety.adverse_events.assessment");
    });

    it("'Отклонения клинико-лабораторных показателей' → assessment", () => {
      expect(cls("Отклонения клинико-лабораторных показателей", "safety")).toBe(
        "safety.adverse_events.assessment",
      );
    });

    it("'Регистрация нежелательных явлениях' → reporting", () => {
      expect(cls("Регистрация нежелательных явлениях", "safety")).toBe(
        "safety.adverse_events.reporting",
      );
    });

    it("'Сообщения о серьезных нежелательных явлениях' → reporting", () => {
      expect(cls("Сообщения о серьезных нежелательных явлениях", "safety")).toBe(
        "safety.adverse_events.reporting",
      );
    });
  });

  describe("ip.contraindications subzone gap (extended scope)", () => {
    it("'Противопоказания' → contraindications", () => {
      expect(cls("Противопоказания", "ip")).toBe("ip.contraindications");
    });

    it("'Передозировка' → contraindications (3 sample → contraindications)", () => {
      expect(cls("Передозировка", "ip")).toBe("ip.contraindications");
    });

    it("'Особые указания и меры предосторожности при применении' → contraindications", () => {
      expect(cls("Особые указания и меры предосторожности при применении", "ip")).toBe(
        "ip.contraindications",
      );
    });

    it("'Влияние на способность управлять транспортными средствами и работать с механизмами' → contraindications", () => {
      expect(
        cls("Влияние на способность управлять транспортными средствами и работать с механизмами", "ip"),
      ).toBe("ip.contraindications");
    });

    it("'Применение при беременности и в период грудного вскармливания' → contraindications", () => {
      expect(cls("Применение при беременности и в период грудного вскармливания", "ip")).toBe(
        "ip.contraindications",
      );
    });

    it("'С осторожностью' → contraindications", () => {
      expect(cls("С осторожностью", "ip")).toBe("ip.contraindications");
    });
  });

  describe("ip.description subzone gap (стандартные пункты карточки)", () => {
    it("'Лекарственная форма' → description", () => {
      expect(cls("Лекарственная форма", "ip")).toBe("ip.description");
    });

    it("'Состав' → description", () => {
      expect(cls("Состав", "ip")).toBe("ip.description");
    });

    it("'Фармакотерапевтическая группа' → description", () => {
      expect(cls("Фармакотерапевтическая группа", "ip")).toBe("ip.description");
    });

    it("'Код АТХ' → description", () => {
      expect(cls("Код АТХ", "ip")).toBe("ip.description");
    });

    it("'Фармакологические свойства' → description", () => {
      expect(cls("Фармакологические свойства", "ip")).toBe("ip.description");
    });

    it("'МНН или группировочное наименование' → description", () => {
      expect(cls("МНН или группировочное наименование", "ip")).toBe("ip.description");
    });

    it("'Производитель' → description", () => {
      expect(cls("Производитель", "ip")).toBe("ip.description");
    });

    it("'Условия отпуска' → description", () => {
      expect(cls("Условия отпуска", "ip")).toBe("ip.description");
    });
  });

  describe("ip.dosing_and_administration subzone gap", () => {
    it("'Описание используемых в исследовании препаратов, их дозировки и схемы применения' → dosing", () => {
      expect(
        cls("Описание используемых в исследовании препаратов, их дозировки и схемы применения", "ip"),
      ).toBe("ip.dosing_and_administration");
    });

    it("'Введение препарата' → dosing", () => {
      expect(cls("Введение препарата", "ip")).toBe("ip.dosing_and_administration");
    });

    it("'Принципы дозирования исследуемых препаратов' → dosing", () => {
      expect(
        cls("Принципы дозирования исследуемых препаратов и способ их применения в рамках исследования", "ip"),
      ).toBe("ip.dosing_and_administration");
    });
  });

  describe("ip.storage_and_accountability subzone gap", () => {
    it("'Срок годности' → storage", () => {
      expect(cls("Срок годности", "ip")).toBe("ip.storage_and_accountability");
    });

    it("'Выдача исследуемых препаратов' → storage", () => {
      expect(cls("Выдача исследуемых препаратов", "ip")).toBe("ip.storage_and_accountability");
    });

    it("'Неиспользованный препарат' → storage", () => {
      expect(cls("Неиспользованный препарат", "ip")).toBe("ip.storage_and_accountability");
    });
  });

  describe("safety.risk_benefit_assessment (правило «Риски»)", () => {
    it("'Краткое описание известных и потенциальных рисков и пользы для субъектов' → risk_benefit", () => {
      expect(
        cls("Краткое описание известных и потенциальных рисков и пользы для субъектов исследования", "safety"),
      ).toBe("safety.risk_benefit_assessment");
    });

    it("'Риски, связанные с приемом исследуемого препарата' → risk_benefit", () => {
      expect(cls("Риски, связанные с приемом исследуемого препарата", "safety")).toBe(
        "safety.risk_benefit_assessment",
      );
    });

    it("'Риски, связанные с выполнением диагностических процедур исследования' → risk_benefit", () => {
      expect(
        cls("Риски, связанные с выполнением диагностических процедур исследования", "safety"),
      ).toBe("safety.risk_benefit_assessment");
    });

    it("'Неизвестные или непредвиденные риски' → risk_benefit", () => {
      expect(cls("Неизвестные или непредвиденные риски", "safety")).toBe(
        "safety.risk_benefit_assessment",
      );
    });
  });

  describe("statistics.analysis_methods subzone gap (закрытый раздел)", () => {
    it("'Описание статистических методов...' → analysis_methods", () => {
      expect(
        cls("Описание статистических методов, которые предполагается использовать", "statistics"),
      ).toBe("statistics.analysis_methods");
    });

    it("'Статистический анализ демографических и иных исходных данных' → analysis_methods", () => {
      expect(
        cls("Статистический анализ демографических и иных исходных данных", "statistics"),
      ).toBe("statistics.analysis_methods");
    });

    it("'Статистический анализ концентраций активного вещества и параметров фармакокинетики' → analysis_methods", () => {
      expect(
        cls("Статистический анализ концентраций активного вещества и параметров фармакокинетики", "statistics"),
      ).toBe("statistics.analysis_methods");
    });

    it("'Статистический анализ параметров безопасности' → analysis_methods", () => {
      expect(
        cls("Статистический анализ параметров безопасности", "statistics"),
      ).toBe("statistics.analysis_methods");
    });
  });

  describe("endpoints.efficacy subzone gap", () => {
    it("'Основные и дополнительные параметры эффективности' → efficacy", () => {
      expect(
        cls("Основные и дополнительные параметры эффективности, оцениваемые в исследовании", "endpoints"),
      ).toBe("endpoints.efficacy");
    });

    it("'Оценка эффективности' → efficacy", () => {
      expect(cls("Оценка эффективности", "endpoints")).toBe("endpoints.efficacy");
    });
  });

  describe("ethics.regulatory_compliance subzone gap", () => {
    it("'Нормативно-правовая база для проведения клинического исследования' → regulatory_compliance", () => {
      expect(
        cls("Нормативно-правовая база для проведения клинического исследования", "ethics"),
      ).toBe("ethics.regulatory_compliance");
    });

    it("'Разрешение на проведение клинического исследования' → regulatory_compliance", () => {
      expect(cls("Разрешение на проведение клинического исследования", "ethics")).toBe(
        "ethics.regulatory_compliance",
      );
    });
  });

  describe("ip.* — отрицательные кейсы (не должны попадать в description/contraindications)", () => {
    it("'Срок годности' → storage_and_accountability, NOT description", () => {
      expect(cls("Срок годности", "ip")).toBe("ip.storage_and_accountability");
    });

    it("'Регистрация беременности' → safety.adverse_events.reporting (не contraindications)", () => {
      // Контекст safety, не ip — это AE reporting
      expect(cls("Регистрация беременности", "safety")).not.toBe("ip.contraindications");
    });

    it("'Методы контрацепции' → procedures.contraception_requirements (не contraindications)", () => {
      expect(cls("Методы контрацепции", "procedures")).not.toBe("ip.contraindications");
    });
  });
});
