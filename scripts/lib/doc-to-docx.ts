/**
 * Конвертация legacy `.doc` → `.docx` через LibreOffice headless.
 *
 * mammoth (используется в pipeline) НЕ поддерживает legacy .doc compound binary
 * format — только OOXML (.docx). Поэтому перед загрузкой .doc-файла в систему
 * его надо сконвертировать. Логика выбора инструмента:
 *
 *   1. `soffice` (Windows: установка LibreOffice добавляет в PATH).
 *   2. `libreoffice` (Linux: типичное имя бинарника).
 *
 * Если ни один не найден — `convertDocToDocx` бросает понятную ошибку, и вызывающий
 * код пропускает файл с предупреждением (вместо падения всего batch).
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";

const execAsync = promisify(exec);

let cachedConverter: string | null | undefined;

async function findConverter(): Promise<string | null> {
  if (cachedConverter !== undefined) return cachedConverter;

  for (const bin of ["soffice", "libreoffice"]) {
    try {
      const { stdout } = await execAsync(`${bin} --version`, { timeout: 10000 });
      if (stdout && stdout.toLowerCase().includes("libreoffice")) {
        cachedConverter = bin;
        return bin;
      }
    } catch {
      // not available
    }
  }
  cachedConverter = null;
  return null;
}

export class ConverterNotFoundError extends Error {
  constructor() {
    super(
      "Для конвертации .doc нужен LibreOffice. Установите его и убедитесь, что 'soffice' доступен в PATH.\n" +
        "  Windows: https://www.libreoffice.org/download/download/  (после установки добавьте в PATH папку %ProgramFiles%\\LibreOffice\\program)\n" +
        "  Linux:   apt-get install libreoffice  (или dnf/pacman аналог)\n" +
        "Альтернатива: предварительно конвертируйте .doc → .docx через MS Word и удалите .doc из директории.",
    );
    this.name = "ConverterNotFoundError";
  }
}

/**
 * Конвертирует `.doc` файл в `.docx` в указанной временной директории.
 * Возвращает путь к созданному `.docx`. Источник не модифицируется.
 *
 * @throws {ConverterNotFoundError} если LibreOffice не найден.
 */
export async function convertDocToDocx(srcPath: string, outDir: string): Promise<string> {
  const converter = await findConverter();
  if (!converter) throw new ConverterNotFoundError();

  await fs.mkdir(outDir, { recursive: true });

  const cmd = `${converter} --headless --convert-to docx --outdir "${outDir}" "${srcPath}"`;
  const { stderr } = await execAsync(cmd, { timeout: 120000 });

  const outName = path.basename(srcPath, path.extname(srcPath)) + ".docx";
  const outPath = path.join(outDir, outName);
  const exists = await fs
    .stat(outPath)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    throw new Error(`Conversion did not produce output file ${outPath}. stderr: ${stderr.slice(0, 500)}`);
  }
  return outPath;
}

export async function isConverterAvailable(): Promise<boolean> {
  return (await findConverter()) !== null;
}
