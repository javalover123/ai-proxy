import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import appIcon from "@/assets/app-icon.png";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLocale } from "@/hooks/useLocale";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function AboutDialog({ open, onOpenChange }: Props) {
  const { t } = useLocale();
  const [version, setVersion] = useState("");

  useEffect(() => {
    if (!open) return;
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="items-center text-center">
          <img src={appIcon} alt="" className="mx-auto size-16 rounded-xl" draggable={false} />
          <DialogTitle className="mt-2">AI Proxy</DialogTitle>
          <DialogDescription>{t("about.description")}</DialogDescription>
        </DialogHeader>

        <div className="text-center text-sm text-muted-foreground">
          {version ? t("about.version", { version }) : null}
        </div>

        <DialogFooter className="sm:justify-center">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("about.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
