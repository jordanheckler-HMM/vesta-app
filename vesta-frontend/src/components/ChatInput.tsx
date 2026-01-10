import { useState, KeyboardEvent, useRef } from "react";
import { Send, Paperclip, X, FileText, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatInputProps {
  onSend: (message: string, files?: File[]) => void;
  onCancel?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
}

const ChatInput = ({ onSend, onCancel, disabled, isStreaming }: ChatInputProps) => {
  const [value, setValue] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    
    // Filter for allowed file types
    const allowedFiles = files.filter(file => {
      const ext = file.name.split('.').pop()?.toLowerCase();
      return ['pdf', 'docx', 'doc', 'csv', 'txt', 'xlsx', 'xls'].includes(ext || '');
    });
    
    if (allowedFiles.length < files.length) {
      alert('Some files were skipped. Only PDF, DOCX, CSV, TXT, and Excel files are supported.');
    }
    
    setAttachedFiles(prev => [...prev, ...allowedFiles]);
    
    // Reset input value so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = () => {
    const trimmed = value.trim();
    if ((trimmed || attachedFiles.length > 0) && !disabled) {
      onSend(trimmed, attachedFiles);
      setValue("");
      setAttachedFiles([]);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-vesta-header-border bg-card p-4">
      <div className="max-w-4xl mx-auto">
        {/* File attachments preview */}
        {attachedFiles.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {attachedFiles.map((file, idx) => (
              <div 
                key={idx} 
                className="flex items-center gap-2 px-3 py-1.5 
                          bg-muted rounded-md text-sm border border-border"
              >
                <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="max-w-[200px] truncate" title={file.name}>
                  {file.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  ({(file.size / 1024).toFixed(1)}KB)
                </span>
                <button
                  onClick={() => removeFile(idx)}
                  className="hover:text-destructive transition-colors"
                  title="Remove file"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        
        {/* Input area */}
        <div className="flex gap-3">
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={attachedFiles.length > 0 
              ? "Add a message about these files (optional)..." 
              : "Paste internal notes, attach files, or describe what you're working through…"}
            className="min-h-[80px] resize-none bg-background border-input text-sm"
            disabled={disabled}
          />
          
          <div className="flex flex-col gap-2 self-end">
            {/* File upload button */}
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              size="icon"
              variant="outline"
              className="h-10 w-10 shrink-0"
              title="Attach files (PDF, DOCX, CSV, TXT, Excel)"
            >
              <Paperclip className="w-4 h-4" />
            </Button>
            
            {/* Send/Stop button - changes based on streaming state */}
            {isStreaming ? (
              <Button
                onClick={onCancel}
                size="icon"
                variant="outline"
                className="h-10 w-10 shrink-0 border-muted-foreground/50 hover:bg-muted"
                title="Stop generating"
              >
                <Square className="w-4 h-4 fill-current text-muted-foreground" />
              </Button>
            ) : (
              <Button
                onClick={handleSend}
                disabled={(!value.trim() && attachedFiles.length === 0) || disabled}
                size="icon"
                className="h-10 w-10 shrink-0"
              >
                <Send className="w-4 h-4" />
              </Button>
            )}
          </div>
          
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.csv,.txt,.xlsx,.xls"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      </div>
    </div>
  );
};

export default ChatInput;
