"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, CardHead, Spinner } from "@/components/ui";

type DocStatus = "pending" | "ingesting" | "ingested" | "failed";

interface Doc {
  id: string;
  name: string;
  bytes: number;
  chars: number;
  status: DocStatus;
  error: string | null;
  entityCount: number | null;
  edgeCount: number | null;
}

/** A file mid-upload — not a document yet, just a row so it isn't invisible while it's being read and parsed. */
interface UploadingFile {
  key: string;
  name: string;
  size: number;
}

/** A document whose pipeline pass hasn't finished (even once) can't be removed yet. */
function isDeletable(status: DocStatus): boolean {
  return status === "ingested" || status === "failed";
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusBadge({ doc }: { doc: Doc }) {
  switch (doc.status) {
    case "pending":
      return <Badge tone="neutral">Not yet analyzed</Badge>;
    case "ingesting":
      return (
        <Badge tone="accent">
          <Spinner className="mr-1" />
          Analyzing…
        </Badge>
      );
    case "ingested":
      return (
        <Badge tone="good">
          {doc.entityCount ?? 0} entities · {doc.edgeCount ?? 0} relationships
        </Badge>
      );
    case "failed":
      return <Badge tone="bad">Analysis failed</Badge>;
  }
}

export function Documents({
  projectId,
  onChange,
  locked,
}: {
  projectId: string;
  onChange: (count: number) => void;
  /** True while a run for this project is actively executing a stage. */
  locked?: boolean;
}) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
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

  // While any document is mid-pipeline, keep polling for it to finish — that
  // is what flips its badge from "Analyzing…" to a result and unblocks its
  // delete button, whether this tab or another one started the build.
  useEffect(() => {
    if (!docs.some((d) => d.status === "ingesting")) return;
    const timer = setTimeout(() => void load(), 2000);
    return () => clearTimeout(timer);
  }, [docs, load]);

  // A run may start (in another tab, or between render and click) after this
  // was disabled client-side — the server enforces the same rule, so surface
  // its refusal the same way an upload/parse failure would show up.
  async function upload(files: FileList | File[]) {
    if (files.length === 0 || locked) return;
    const picked = Array.from(files);
    // Optimistic rows so a large PDF/docx being parsed isn't just a spinner on
    // the Add button — the files that are in flight are visible immediately.
    setUploading(
      picked.map((f, i) => ({ key: `${Date.now()}-${i}`, name: f.name, size: f.size })),
    );
    setBusy(true);
    setProblems([]);
    try {
      const form = new FormData();
      for (const file of picked) form.append("files", file);
      const response = await fetch(`/api/projects/${projectId}/documents`, {
        method: "POST",
        body: form,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProblems([{ name: "Upload", reason: result.error ?? "The upload was rejected." }]);
        return;
      }
      if (result.failed?.length) setProblems(result.failed);
      await load();
    } finally {
      setUploading([]);
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const doc = docs.find((d) => d.id === id);
    if (locked || !doc || !isDeletable(doc.status)) return;
    // Extracted text is not recoverable once the row is gone, and the upload took
    // real effort — never delete on a single click.
    if (confirming !== id) {
      setConfirming(id);
      return;
    }
    setConfirming(null);
    const response = await fetch(`/api/documents/${id}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setProblems([
        { name: doc?.name ?? "Remove", reason: body.error ?? "Could not remove it." },
      ]);
      return;
    }
    await load();
  }

  return (
    <Card>
      <CardHead
        title="Requirement documents"
        hint="pdf, docx, md, txt, csv, json, yaml, html"
        action={
          <Button
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={busy || locked}
          >
            {busy ? <Spinner /> : null} Add
          </Button>
        }
      />
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        disabled={locked}
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files);
          e.target.value = "";
        }}
      />

      {locked ? (
        <p className="border-b border-line bg-canvas px-4 py-2 text-xs text-ink-faint">
          A run is in progress — cancel it to add or remove documents.
        </p>
      ) : null}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!locked) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!locked) void upload(e.dataTransfer.files);
        }}
        className={`px-4 py-3 ${dragging && !locked ? "bg-accent-soft" : ""}`}
      >
        {docs.length === 0 && uploading.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-faint">
            Drop the PRD, specs, user stories and acceptance criteria here.
          </p>
        ) : (
          // A fixed max-height so the card stops growing once a project holds
          // more than a handful of documents — 10, 50 or all 100 the project
          // allows scroll inside this box instead of pushing the rest of the
          // page down. Under that height (a handful of documents) the content
          // is shorter than the box, so no scrollbar appears at all.
          <ul className="max-h-96 divide-y divide-line overflow-y-auto">
            {uploading.map((f) => (
              <li key={f.key} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{f.name}</p>
                  <p className="text-xs text-ink-faint">{humanBytes(f.size)}</p>
                </div>
                <Badge tone="accent">
                  <Spinner className="mr-1" />
                  Uploading…
                </Badge>
              </li>
            ))}
            {docs.map((doc) => {
              const deletable = isDeletable(doc.status);
              return (
                <li key={doc.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{doc.name}</p>
                    <p className="text-xs text-ink-faint">
                      {humanBytes(doc.bytes)} · {doc.chars.toLocaleString()} characters
                      extracted
                    </p>
                    {doc.status === "failed" && doc.error ? (
                      <p className="mt-0.5 truncate text-xs text-red-600" title={doc.error}>
                        {doc.error}
                      </p>
                    ) : null}
                  </div>
                  <StatusBadge doc={doc} />
                  <Button
                    size="sm"
                    variant={confirming === doc.id ? "primary" : "ghost"}
                    onClick={() => void remove(doc.id)}
                    onBlur={() => setConfirming((c) => (c === doc.id ? null : c))}
                    disabled={locked || !deletable}
                    title={
                      locked || deletable
                        ? undefined
                        : doc.status === "ingesting"
                          ? "Being analyzed by the AI pipeline — wait for it to finish."
                          : "Build the product model at least once before removing this document."
                    }
                    aria-label={
                      confirming === doc.id
                        ? `Confirm removing ${doc.name}`
                        : `Remove ${doc.name}`
                    }
                  >
                    {confirming === doc.id ? "Confirm" : "Remove"}
                  </Button>
                </li>
              );
            })}
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
