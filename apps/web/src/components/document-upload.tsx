"use client";

import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/cn";
import { Upload, FileText, Loader2, Check, X } from "lucide-react";

interface DocumentUploadProps {
  studyId: string;
  onSuccess?: () => void;
}

export function DocumentUpload({ studyId, onSuccess }: DocumentUploadProps) {
  const [step, setStep] = useState<"idle" | "form" | "uploading" | "done" | "error">("idle");
  const [docType, setDocType] = useState<string>("protocol");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();

  const createDoc = trpc.document.create.useMutation();
  const getUploadUrl = trpc.document.getUploadUrl.useMutation();
  const confirmUpload = trpc.document.confirmUpload.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !title) return;

    setStep("uploading");
    setError("");

    try {
      const doc = await createDoc.mutateAsync({
        studyId,
        type: docType as any,
        title,
      });

      const { versionId, storageKey } = await getUploadUrl.mutateAsync({
        documentId: doc.id,
      });

      const buffer = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), "")
      );

      await confirmUpload.mutateAsync({
        versionId,
        fileBuffer: base64,
      });

      setStep("done");
      utils.document.listByStudy.invalidate({ studyId });
      onSuccess?.();

      setTimeout(() => {
        setStep("idle");
        setTitle("");
        setFile(null);
        setDocType("protocol");
      }, 2000);
    } catch (err: any) {
      setError(err.message ?? "Ошибка загрузки");
      setStep("error");
    }
  };

  if (step === "idle") {
    return (
      <button
        onClick={() => setStep("form")}
        className="inline-flex items-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-4 py-3 text-sm text-gray-500 hover:border-brand-400 hover:text-brand-600 transition-colors w-full justify-center"
      >
        <Upload className="h-4 w-4" />
        Загрузить документ
      </button>
    );
  }

  if (step === "done") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-green-50 p-4 text-sm text-green-700">
        <Check className="h-5 w-5" />
        Документ успешно загружен!
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border bg-white p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Загрузка документа</h3>
        <button
          type="button"
          onClick={() => { setStep("idle"); setError(""); }}
          className="text-gray-400 hover:text-gray-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Название</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="Напр., Протокол в1.0"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Тип документа</label>
        <select
          value={docType}
          onChange={(e) => setDocType(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="protocol">Протокол</option>
          <option value="icf">ИС (информированное согласие)</option>
          <option value="ib">БИ (брошюра исследователя)</option>
          <option value="csr">ОКИ (отчёт клинического исследования)</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Файл Word (.docx)</label>
        <div
          onClick={() => fileRef.current?.click()}
          className={cn(
            "flex items-center gap-3 rounded-lg border-2 border-dashed p-4 cursor-pointer transition-colors",
            file ? "border-brand-300 bg-brand-50" : "border-gray-300 hover:border-gray-400"
          )}
        >
          <FileText className={cn("h-8 w-8", file ? "text-brand-600" : "text-gray-400")} />
          <div>
            {file ? (
              <>
                <p className="text-sm font-medium text-gray-900">{file.name}</p>
                <p className="text-xs text-gray-500">
                  {(file.size / 1024).toFixed(1)} КБ
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-600">Нажмите, чтобы выбрать файл .docx</p>
                <p className="text-xs text-gray-400">Макс. 50 МБ</p>
              </>
            )}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <button
        type="submit"
        disabled={!file || !title || step === "uploading"}
        className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {step === "uploading" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Загрузка...
          </>
        ) : (
          <>
            <Upload className="h-4 w-4" />
            Загрузить
          </>
        )}
      </button>
    </form>
  );
}
