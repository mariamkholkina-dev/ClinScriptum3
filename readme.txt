cd /workspace
mkdir embedding_api
cd embedding_api
python3 -m venv venv
source venv/bin/activate
pip install fastapi uvicorn "sentence-transformers[cuda]" pydantic requests


apt update
apt install nano -y
apt install lsof -y
cd /workspace/embedding_api
nano main.py


cd /workspace/embedding_api
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8002

apt install lsof -y
lsof -i :8002

ollama run llama3:8b




HF_TOKEN=<your-hf-token>

VLLM_API_KEY=<your-api-key>

--host 0.0.0.0 --port 8000 --model Qwen/Qwen3-Next-80B-A3B-Thinking-FP8 --dtype bfloat16  --gpu-memory-utilization 0.90 --api-key $VLLM_API_KEY --tensor-parallel-size 2

h100 PCI 160Gb 40Gb '--max-model-len 262144'
--host 0.0.0.0 --port 8000 --model cpatonn/Qwen3-Next-80B-A3B-Instruct-AWQ-4bit  --max-model-len 128000 --speculative-config '{"method":"qwen3_next_mtp","num_speculative_tokens":2}' --api-key $VLLM_API_KEY 


Qwen/Qwen3-Next-80B-A3B-Thinking-FP8 --host 0.0.0.0 --port 8000 --dtype auto --enforce-eager --gpu-memory-utilization 0.95 --max-model-len 262144 --tensor-parallel-size 4


python -m protocol_preprocessor.preprocess_v2 preprocess "C:\Users\0\clinnexus\output\STР_08_25_Протокол_v1_11.08.2025.docx"  -o "C:\Users\0\clinnexus\output\3. Протокол_VLT-015_2.0_12 09 2025 для ГРЛС.docx v3\" --split-zones --llm-enabled  
Аргумент	Тип	По умолчанию	Описание
input_docx	позиционный (обязательный)	—	Путь к входному файлу .docx
-o, --out-dir	строка	"."	Каталог для выходных файлов
--keep-toc	флаг	False	Не вырезать оглавление из текста
--noise-pattern	строка (можно несколько раз)	[]	Дополнительный regex для шумовых строк (можно указать несколько раз)
--no-default-noise	флаг	False	Отключить стандартные шумовые паттерны
--column-sep	строка	" \| "	Разделитель колонок таблицы
--table-format	выбор: matrix, csv	"matrix"	Формат экспорта таблиц
--split-zones	флаг	False	Сформировать отдельные файлы по зонам
--config	строка	None	Путь к JSON-конфигу v2
--llm-enabled	флаг	False	Включить LLM-классификацию зон (по умолчанию выключено)
--llm-base-url	строка	None	Базовый URL LLM (совместимый с OpenAI)
--llm-api-key	строка	None	API-ключ LLM
--llm-model	строка	None	Название модели LLM
--llm-timeout-seconds	int	60	Таймаут LLM в секундах
--llm-max-output-tokens	int	1200	Лимит токенов ответа LLM
--llm-cache-path	строка	".cache/llm_zone_cache.jsonl"	Путь к JSONL-кэшу LLM
--llm-temperature	float	0.0	Температура LLM
--log-level	строка	"INFO"	Уровень логирования (DEBUG, INFO, WARNING, ERROR)


python -m protocol_preprocessor build-consistency-prompts "C:\Users\0\clinnexus\output\3. Протокол_VLT-015_2.0_12 09 2025 для ГРЛС.docx v3\zones_v2" -o "C:\Users\0\clinnexus\output\3. Протокол_VLT-015_2.0_12 09 2025 для ГРЛС.docx v3\llm_tasks" --context-limit 260000
Аргумент	По умолчанию	Описание
-o, --out-dir	consistency_output	Каталог для выходных файлов
--context-limit	32000	Лимит контекста (в токенах) для планировщика
--config	None	Путь к JSON-конфигу ConsistencyConfig (опционально)
--log-level	INFO	Уровень логирования (DEBUG, INFO, WARNING, ERROR)
--rules	None	Путь к issue_rules.yaml для enum enforcement issue_type


python scripts/run_consistency_batch.py --manifest "C:\Users\0\clinnexus\output\3. Протокол_VLT-015_2.0_12 09 2025 для ГРЛС.docx v3\llm_tasks\consistency_prompts\manifest.json" --output "C:\Users\0\clinnexus\output\3. Протокол_VLT-015_2.0_12 09 2025 для ГРЛС.docx v3\llm_tasks\consistency_prompts\"


 python postprocess_issues.py --input "C:\Users\0\clinnexus\output\llm_tasks\consistency_prompts\issues.json" --taxonomy taxonomy.yaml --rules issue_rules.yaml --out-clean issues_clean.json --out-suppressed issues_suppressed.json --out-report issues_report.json --llm-zone-merge 