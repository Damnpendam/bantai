"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, CardHead, Spinner } from "@/components/ui";

interface Doc {
  id: string;
  name: string;
  bytes: number;
  chars: number;
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function Documents({
  projectId,
  onChange,
}: {
  projectId: string;
  onChange: (count: number) => void;
}) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [problems, setProblems] = useState<{ name: string; reason: string }[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const data = await fetch(`/api/projects/${projectId}/documents`).then((r) =>
      r.json(),
    );
    setDocs(data.documents);
    onChange(data.documents.length);
  }, [projectId, onChange]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(files: FileList | File[]) {
    if (files.length === 0) return;
    setBusy(true);
    setProblems([]);
    const form = new FormData();
    for (const file of Array.from(files)) form.append("files", file);
    const result = await fetch(`/api/projects/${projectId}/documents`, {
      method: "POST",
      body: form,
    }).then((r) => r.json());
    setBusy(false);
    if (result.failed?.length) setProblems(result.failed);
    await load();
  }

  async function remove(id: string) {
    // Extracted text is not recoverable once the row is gone, and the upload took
    // real effort — never delete on a single click.
    if (confirming !== id) {
      setConfirming(id);
      return;
    }
    setConfirming(null);
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <Card>
      <CardHead
        title="Requirement documents"
        hint="pdf, docx, md, txt, csv, json, yaml, html"
        action={
          <Button size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? <Spinner /> : null} Add
          </Button>
        }
      />
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files);
          e.target.value = "";
        }}
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files);
        }}
        className={`px-4 py-3 ${dragging ? "bg-accent-soft" : ""}`}
      >
        {docs.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-faint">
            Drop the PRD, specs, user stories and acceptance criteria here.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {docs.map((doc) => (
              <li key={doc.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{doc.name}</p>
                  <p className="text-xs text-ink-faint">
                    {humanBytes(doc.bytes)} · {doc.chars.toLocaleString()} characters
                    extracted
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={confirming === doc.id ? "primary" : "ghost"}
                  onClick={() => void remove(doc.id)}
                  onBlur={() => setConfirming((c) => (c === doc.id ? null : c))}
                  aria-label={
                    confirming === doc.id
                      ? `Confirm removing ${doc.name}`
                      : `Remove ${doc.name}`
                  }
                >
                  {confirming === doc.id ? "Confirm" : "Remove"}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {problems.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {problems.map((p) => (
              <li key={p.name} className="text-xs text-red-600">
                {p.name}: {p.reason}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}
