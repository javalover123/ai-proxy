// src/features/new-request/tabs/FormDataEditor.tsx

import { useCallback, useMemo } from "react";
import { useLocale } from "@/hooks/useLocale";
import { parseFormDataBody, serializeFormDataBody } from "@/lib/body-utils";
import type { KeyValuePair } from "@/types/collection";
import { KeyValueEditor } from "./KeyValueEditor";

interface FormDataEditorProps {
  body: string;
  onChange: (body: string) => void;
}

export default function FormDataEditor({ body, onChange }: FormDataEditorProps) {
  const { t } = useLocale();

  const entries: KeyValuePair[] = useMemo(() => parseFormDataBody(body), [body]);

  const handleChange = useCallback(
    (next: KeyValuePair[]) => {
      onChange(serializeFormDataBody(next));
    },
    [onChange],
  );

  return (
    <KeyValueEditor
      entries={entries}
      onChange={handleChange}
      addLabel={t("requestEditor.bodyFormDataAddField")}
      emptyLabel=""
    />
  );
}
