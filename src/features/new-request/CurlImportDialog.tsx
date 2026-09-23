import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLocale } from "@/hooks/useLocale";
import { type CurlParsedResultOk, parseCurl } from "@/lib/curl";

export interface CurlImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (result: CurlParsedResultOk) => void;
}

export function CurlImportDialog({ open, onOpenChange, onConfirm }: CurlImportDialogProps) {
  const { t } = useLocale();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  // 弹窗关闭时清空 textarea 和 error
  useEffect(() => {
    if (!open) {
      setValue("");
      setError("");
    }
  }, [open]);

  const handleConfirm = useCallback(() => {
    const result = parseCurl(value.trim());
    if (result.ok) {
      onConfirm(result);
      onOpenChange(false);
    } else {
      setError(result.error);
    }
  }, [value, onConfirm, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("collection.curlDialogTitle")}</DialogTitle>
        </DialogHeader>

        <textarea
          className="w-full h-40 p-3 rounded-md border border-border bg-surface-deep text-prose-md font-mono
                     text-foreground placeholder:text-muted-foreground/50 resize-none
                     focus:outline-none focus:ring-2 focus:ring-primary/30"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError("");
          }}
          placeholder={t("collection.curlDialogPlaceholder")}
          autoFocus
        />

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("settings.cancel")}
          </Button>
          <Button variant="outline" onClick={handleConfirm} disabled={!value.trim()}>
            {t("collection.importCurl")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
