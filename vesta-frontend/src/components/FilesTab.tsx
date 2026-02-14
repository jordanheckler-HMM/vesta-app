import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCcw, Trash2, Upload } from "lucide-react";

import { FolderSummary } from "@/components/ChatSidebar";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";

const BACKEND_BASE_URL = "http://localhost:8090";

export interface KnowledgeDocument {
  id: string;
  folder_id?: string;
  filename: string;
  content_hash: string;
  size_bytes: number;
  mime_type?: string | null;
  chunk_count: number;
  created_at: string;
}

export interface KnowledgeUploadResult {
  filename: string;
  status: "indexed" | "duplicate" | "unsupported" | "error";
  reason?: string;
  document?: KnowledgeDocument;
}

interface FilesTabProps {
  isMiniView?: boolean;
  folders?: FolderSummary[];
  defaultFolderId?: string | null;
}

type KnowledgeScope = "global" | "folder";

const FilesTab = ({
  isMiniView,
  folders = [],
  defaultFolderId = null,
}: FilesTabProps) => {
  const [scope, setScope] = useState<KnowledgeScope>("global");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(
    defaultFolderId,
  );
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [results, setResults] = useState<KnowledgeUploadResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalChunks = useMemo(() => {
    return documents.reduce((acc, document) => acc + document.chunk_count, 0);
  }, [documents]);

  useEffect(() => {
    if (defaultFolderId && folders.some((folder) => folder.id === defaultFolderId)) {
      setSelectedFolderId(defaultFolderId);
    }
  }, [defaultFolderId, folders]);

  const canUseFolderScope = folders.length > 0;
  const hasFolderSelection = Boolean(selectedFolderId);

  const getFilesEndpoint = useCallback(() => {
    if (scope === "folder") {
      if (!selectedFolderId) {
        return null;
      }
      return `${BACKEND_BASE_URL}/folders/${selectedFolderId}/files`;
    }
    return `${BACKEND_BASE_URL}/knowledge/files`;
  }, [scope, selectedFolderId]);

  const fetchDocuments = useCallback(async () => {
    const endpoint = getFilesEndpoint();
    if (!endpoint) {
      setDocuments([]);
      return;
    }

    setIsLoading(true);
    try {
      let response: Response | null = null;
      let lastError: Error | null = null;

      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          response = await fetch(endpoint);
          if (!response.ok) {
            const detail = await response.text();
            if (response.status === 404) {
              throw new Error(
                scope === "folder"
                  ? "Selected folder no longer exists. Choose another folder."
                  : "Knowledge endpoints unavailable (404). Fully quit other Vesta instances (Cmd+Q), then restart dev mode.",
              );
            }
            throw new Error(`Knowledge request failed (${response.status}): ${detail}`);
          }
          break;
        } catch (error) {
          lastError =
            error instanceof Error
              ? error
              : new Error("Failed to load knowledge documents");
          if (attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
          }
        }
      }

      if (!response || !response.ok) {
        throw lastError || new Error("Failed to load knowledge documents");
      }

      const body = await response.json();
      setDocuments(body.documents || []);
    } catch (error) {
      console.error("Failed to list knowledge files", error);
      toast({
        variant: "destructive",
        title: "Could not load knowledge files",
        description:
          error instanceof Error
            ? error.message
            : "Make sure the backend is running and try again.",
      });
    } finally {
      setIsLoading(false);
    }
  }, [getFilesEndpoint, scope]);

  useEffect(() => {
    if (!isMiniView) {
      void fetchDocuments();
    }
  }, [fetchDocuments, isMiniView]);

  const handleUpload = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    const endpoint = getFilesEndpoint();
    if (!endpoint) {
      toast({
        variant: "destructive",
        title: "Select a folder first",
        description:
          "Choose a folder before uploading folder-specific knowledge files.",
      });
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));

      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Knowledge upload failed");
      }

      const body = await response.json();
      const nextResults = (body.results || []) as KnowledgeUploadResult[];
      setResults(nextResults);
      await fetchDocuments();

      const indexedCount = nextResults.filter(
        (result) => result.status === "indexed",
      ).length;
      toast({
        title: "Knowledge upload complete",
        description:
          indexedCount > 0
            ? `${indexedCount} file${indexedCount === 1 ? "" : "s"} indexed.`
            : "No new files were indexed.",
      });
    } catch (error) {
      console.error("Knowledge upload failed", error);
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: "Please try again.",
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDelete = async (documentId: string) => {
    const endpoint = getFilesEndpoint();
    if (!endpoint) {
      return;
    }

    setDeletingId(documentId);
    try {
      const response = await fetch(`${endpoint}/${documentId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Delete failed");
      }

      setDocuments((prev) =>
        prev.filter((document) => document.id !== documentId),
      );
      toast({
        title: "Document removed",
        description: "The document was removed from the local knowledge base.",
      });
    } catch (error) {
      console.error("Failed to delete knowledge document", error);
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: "Please try again.",
      });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto w-full px-6 py-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Files</h2>
          <p className="text-sm text-muted-foreground">
            Upload global or folder-specific SOPs and docs for retrieval grounding.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Indexed documents: {documents.length} | Chunks: {totalChunks}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={scope === "global" ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setScope("global");
                setResults([]);
              }}
            >
              Global knowledge
            </Button>
            <Button
              type="button"
              variant={scope === "folder" ? "default" : "outline"}
              size="sm"
              disabled={!canUseFolderScope}
              onClick={() => {
                setScope("folder");
                setResults([]);
              }}
            >
              Folder knowledge
            </Button>
          </div>

          {scope === "folder" && (
            <select
              value={selectedFolderId || ""}
              onChange={(event) =>
                setSelectedFolderId(event.target.value || null)
              }
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground min-w-[220px]"
              aria-label="Folder selection for files scope"
            >
              <option value="">Select folder...</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => fetchDocuments()}
              disabled={
                isLoading ||
                isUploading ||
                (scope === "folder" && !hasFolderSelection)
              }
            >
              <RefreshCcw className="w-4 h-4 mr-1.5" />
              Refresh
            </Button>
            <Button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || (scope === "folder" && !hasFolderSelection)}
            >
              {isUploading ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-1.5" />
              )}
              Add Files
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(event) =>
                handleUpload(Array.from(event.target.files || []))
              }
              className="hidden"
            />
          </div>
        </div>
      </div>

      {results.length > 0 && (
        <div className="rounded-md border border-border bg-card p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Last upload</p>
          {results.map((result, idx) => (
            <div
              key={`${result.filename}-${idx}`}
              className="text-sm flex items-center justify-between gap-3"
            >
              <span className="truncate" title={result.filename}>
                {result.filename}
              </span>
              <span className="text-xs text-muted-foreground shrink-0">
                {result.status}
                {result.reason ? `: ${result.reason}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-md border border-border overflow-hidden">
        <div className="grid grid-cols-[2fr_90px_120px_120px] gap-3 px-4 py-2 text-xs font-medium uppercase text-muted-foreground bg-muted/40">
          <span>Filename</span>
          <span>Chunks</span>
          <span>Size</span>
          <span>Actions</span>
        </div>

        {scope === "folder" && !hasFolderSelection ? (
          <div className="px-4 py-10 text-sm text-muted-foreground">
            Select a folder to view and manage folder-specific knowledge files.
          </div>
        ) : isLoading ? (
          <div className="px-4 py-10 text-sm text-muted-foreground">
            Loading documents...
          </div>
        ) : documents.length === 0 ? (
          <div className="px-4 py-10 text-sm text-muted-foreground">
            No files indexed yet. Upload SOPs or internal docs to build your local
            knowledge base.
          </div>
        ) : (
          documents.map((document) => (
            <div
              key={document.id}
              className="grid grid-cols-[2fr_90px_120px_120px] gap-3 px-4 py-3 text-sm border-t border-border items-center"
            >
              <span className="truncate" title={document.filename}>
                {document.filename}
              </span>
              <span>{document.chunk_count}</span>
              <span>{(document.size_bytes / 1024).toFixed(1)} KB</span>
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={deletingId === document.id}
                  onClick={() => handleDelete(document.id)}
                  className="text-destructive hover:text-destructive"
                  aria-label={`Delete ${document.filename}`}
                  title="Delete file"
                >
                  {deletingId === document.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default FilesTab;
