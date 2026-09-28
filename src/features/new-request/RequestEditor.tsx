import { useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocale } from "@/hooks/useLocale";
import { parseFormDataBody, parseUrlEncoded } from "@/lib/body-utils";
import type { BodyType, KeyValuePair } from "@/types/collection";
import AuthTab from "./tabs/AuthTab";
import BodyTab from "./tabs/BodyTab";
import { KeyValueEditor } from "./tabs/KeyValueEditor";

type EditorTab = "params" | "body" | "headers" | "cookies" | "auth";

const TABS: { id: EditorTab; labelKey: string }[] = [
  { id: "params", labelKey: "requestEditor.params" },
  { id: "body", labelKey: "requestEditor.body" },
  { id: "headers", labelKey: "requestEditor.headers" },
  { id: "cookies", labelKey: "requestEditor.cookies" },
  { id: "auth", labelKey: "requestEditor.auth" },
];

interface RequestEditorProps {
  params: KeyValuePair[];
  headers: KeyValuePair[];
  cookies: KeyValuePair[];
  body: string;
  bodyType: BodyType;
  onParamsChange: (params: KeyValuePair[]) => void;
  onHeadersChange: (headers: KeyValuePair[]) => void;
  onCookiesChange: (cookies: KeyValuePair[]) => void;
  onBodyChange: (body: string) => void;
  onBodyTypeChange: (bodyType: BodyType) => void;
}

export default function RequestEditor(props: RequestEditorProps) {
  const { t } = useLocale();
  const [tab, setTab] = useState<EditorTab>("body");

  const enabledCount = (entries: KeyValuePair[]) => entries.filter((e) => e.enabled !== false).length;

  // Body 的计数：raw (json/xml/text) 有内容 → 1；urlencoded / form-data 按勾选条目数
  const bodyCount = useMemo(() => {
    const bt = props.bodyType;
    const b = props.body;
    if (!b) return 0;
    if (bt === "urlencoded") {
      return parseUrlEncoded(b).filter((e) => e.enabled !== false).length;
    }
    if (bt === "multipart") {
      return parseFormDataBody(b).filter((e) => e.enabled !== false).length;
    }
    if (bt === "none" || bt === "auto") return 0;
    // json / xml / text → 有内容就算 1
    return b.trim() ? 1 : 0;
  }, [props.bodyType, props.body]);

  const tabCounts: Record<EditorTab, number | null> = {
    params: enabledCount(props.params),
    body: bodyCount,
    headers: enabledCount(props.headers),
    cookies: enabledCount(props.cookies),
    auth: null,
  };

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as EditorTab)}
      className="flex min-h-0 flex-1 flex-col overflow-hidden gap-0"
    >
      <TabsList
        variant="line"
        className="shrink-0 justify-start border-b border-surface-elevated bg-surface-elevated/20 px-0 rounded-none"
      >
        {TABS.map((x) => {
          const count = tabCounts[x.id];
          return (
            <TabsTrigger key={x.id} value={x.id} className="text-ui-sm">
              {t(x.labelKey)}
              {count != null && count > 0 && (
                <span className="ml-1 text-ui-2xs text-emerald-400 dark:text-emerald-300 tabular-nums">({count})</span>
              )}
            </TabsTrigger>
          );
        })}
      </TabsList>

      <TabsContent value="params" className="min-h-0 flex-1 overflow-hidden mt-0">
        <ScrollArea className="h-full">
          <KeyValueEditor
            entries={props.params}
            onChange={props.onParamsChange}
            addLabel={t("requestEditor.addParam")}
            emptyLabel=""
            excludedTypes={["file"]}
          />
        </ScrollArea>
      </TabsContent>
      <TabsContent value="body" className="min-h-0 flex-1 overflow-hidden mt-0 flex flex-col">
        <BodyTab
          body={props.body}
          bodyType={props.bodyType}
          onBodyChange={props.onBodyChange}
          onBodyTypeChange={props.onBodyTypeChange}
        />
      </TabsContent>
      <TabsContent value="headers" className="min-h-0 flex-1 overflow-hidden mt-0">
        <ScrollArea className="h-full">
          <KeyValueEditor
            entries={props.headers}
            onChange={props.onHeadersChange}
            addLabel={t("requestEditor.addHeader")}
            emptyLabel={t("detail.noHeaders")}
            excludedTypes={["file"]}
          />
        </ScrollArea>
      </TabsContent>
      <TabsContent value="cookies" className="min-h-0 flex-1 overflow-hidden mt-0">
        <ScrollArea className="h-full">
          <KeyValueEditor
            entries={props.cookies}
            onChange={props.onCookiesChange}
            addLabel={t("requestEditor.addCookie")}
            emptyLabel=""
            excludedTypes={["file"]}
          />
        </ScrollArea>
      </TabsContent>
      <TabsContent value="auth" className="min-h-0 flex-1 overflow-hidden mt-0">
        <ScrollArea className="h-full">
          <AuthTab headers={props.headers} onHeadersChange={props.onHeadersChange} />
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
}
