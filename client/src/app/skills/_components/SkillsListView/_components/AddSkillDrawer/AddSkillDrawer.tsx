/* AddSkillDrawer — Drawer + Tabs: file | url | community. All three import
   sources funnel into the SAME preview-then-confirm flow: whichever tab
   triggers `preview` to be set, the shared preview panel + footer take over
   regardless of which tab is still selected (source is carried on the
   preview result itself, so `doConfirm` needs no per-tab branching). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Drawer,
  EmptyState,
  ErrorState,
  FormField,
  Icon,
  Markdown,
  Skeleton,
  Tabs,
  TextInput,
  Textarea,
} from "@devdigest/ui";
import type { SkillImportPreview } from "@devdigest/shared";
import {
  useCommunitySkills,
  useCreateSkill,
  useImportPreview,
} from "../../../../../../lib/hooks/skills";
import { ApiError } from "../../../../../../lib/api";
import { ACCEPTED_FILE_TYPES, DRAWER_WIDTH, PASTE_FILENAME } from "./constants";
import { readFileAsBase64, textToBase64 } from "./helpers";
import { s } from "./styles";

type Tab = "file" | "url" | "community";

export function AddSkillDrawer({
  initialTab,
  onClose,
}: {
  initialTab: Tab;
  onClose: () => void;
}) {
  const t = useTranslations("skills");
  const [tab, setTab] = React.useState<Tab>(initialTab);

  // --- file tab state ---
  const [name, setName] = React.useState("");
  const [pasteBody, setPasteBody] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [preview, setPreview] = React.useState<SkillImportPreview | null>(null);
  const [draftName, setDraftName] = React.useState("");
  const [draftDescription, setDraftDescription] = React.useState("");
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // --- url tab state ---
  const [urlValue, setUrlValue] = React.useState("");

  // --- community tab state ---
  const [communityQuery, setCommunityQuery] = React.useState("");
  const communitySkills = useCommunitySkills(communityQuery || undefined);

  const importPreview = useImportPreview();
  const createSkill = useCreateSkill();

  const hasContent = Boolean(file) || pasteBody.trim().length > 0;

  const pickFile = async (f: File) => {
    setFile(f);
    setPasteBody(""); // file and paste are mutually exclusive sources
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) pickFile(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) pickFile(f);
  };

  /*
   * Design choice: the paste-into-textarea fallback is sent through the SAME
   * import-preview flow as a real file upload (as a pseudo file named
   * PASTE_FILENAME), rather than a separate `POST /skills` shortcut. That
   * keeps one code path, one preview step, and one confirm action instead of
   * maintaining two parallel creation flows — and it means pasted content
   * gets the same server-side parsing (name/description/type derivation,
   * skipped-entries reporting) a real upload gets.
   */
  const doPreview = async () => {
    const content_b64 = file ? await readFileAsBase64(file) : textToBase64(pasteBody);
    const filename = file ? file.name : PASTE_FILENAME;
    const result = await importPreview.mutateAsync({ source: "file", filename, content_b64 });
    setPreview(result);
    setDraftName(name.trim() || result.name);
    setDraftDescription(result.description);
  };

  const doPreviewUrl = async () => {
    const result = await importPreview.mutateAsync({ source: "url", url: urlValue.trim() });
    setPreview(result);
    setDraftName(result.name);
    setDraftDescription(result.description);
  };

  const doPreviewCommunity = async (id: string) => {
    const result = await importPreview.mutateAsync({ source: "community", id });
    setPreview(result);
    setDraftName(result.name);
    setDraftDescription(result.description);
  };

  const doBack = () => {
    setPreview(null);
    importPreview.reset();
  };

  const doConfirm = async () => {
    if (!preview) return;
    // Imported skills always land disabled — the "needs vetting" badge and
    // the enabled toggle in SkillPreview ARE the vetting step.
    await createSkill.mutateAsync({
      name: draftName.trim() || preview.name,
      description: draftDescription,
      type: preview.type,
      body: preview.body,
      source: preview.source,
      enabled: false,
    });
    onClose();
  };

  const importError =
    importPreview.error instanceof ApiError ? importPreview.error.message : importPreview.isError ? t("drawer.importFailed") : null;
  const confirmError =
    createSkill.error instanceof ApiError ? createSkill.error.message : createSkill.isError ? t("drawer.importFailed") : null;

  const tabs = [
    { key: "file", label: t("drawer.tabs.file"), icon: "File" as const },
    { key: "url", label: t("drawer.tabs.url"), icon: "Link" as const },
    { key: "community", label: t("drawer.tabs.community"), icon: "Users" as const },
  ];

  // Once a preview exists (from ANY of the three tabs — source is carried on
  // the preview result itself), the shared preview panel + footer take over
  // regardless of which tab is still selected.
  const footer = preview ? (
    <div style={s.footer}>
      <Button kind="ghost" onClick={doBack} disabled={createSkill.isPending}>
        {t("file.back")}
      </Button>
      <Button kind="primary" icon="Plus" onClick={doConfirm} disabled={createSkill.isPending}>
        {createSkill.isPending ? t("file.confirming") : t("file.confirm")}
      </Button>
    </div>
  ) : tab === "file" ? (
    <div style={s.footer}>
      <Button kind="primary" icon="Upload" onClick={doPreview} disabled={!hasContent || importPreview.isPending}>
        {importPreview.isPending ? t("file.importing") : t("file.import")}
      </Button>
    </div>
  ) : tab === "url" ? (
    <div style={s.footer}>
      <Button kind="primary" icon="Link" onClick={doPreviewUrl} disabled={!urlValue.trim() || importPreview.isPending}>
        {importPreview.isPending ? t("url.fetching") : t("url.import")}
      </Button>
    </div>
  ) : undefined; // community tab imports per-card, no single footer action

  return (
    <Drawer width={DRAWER_WIDTH} title={t("drawer.title")} subtitle={t("drawer.subtitle")} onClose={onClose} footer={footer}>
      <Tabs tabs={tabs} value={tab} onChange={(k) => setTab(k as Tab)} pad="0 0 16px" />

      {preview ? (
        <div style={s.body}>
          <FormField label={t("file.previewNameLabel")}>
            <TextInput value={draftName} onChange={setDraftName} />
          </FormField>
          <FormField label={t("file.previewDescriptionLabel")} hint={t("edit.descriptionHint")}>
            <TextInput value={draftDescription} onChange={setDraftDescription} />
          </FormField>
          <FormField label={t("file.previewHeading")}>
            <div style={s.previewBody}>
              <Markdown>{preview.body}</Markdown>
            </div>
          </FormField>
          {preview.skipped.length > 0 && (
            <div style={s.skippedLine}>
              <Icon.Info size={13} />
              {t("file.skipped", { count: preview.skipped.length })}
            </div>
          )}
          {confirmError && <div style={s.errorText}>{confirmError}</div>}
        </div>
      ) : (
        <>
          {tab === "file" && (
            <div style={s.body}>
              <FormField label={t("file.nameLabel")} hint={t("file.nameHint")}>
                <TextInput value={name} onChange={setName} placeholder={t("file.namePlaceholder")} />
              </FormField>

              <FormField label={t("file.bodyLabel")} hint={t("file.bodyHint")}>
                <Textarea
                  value={pasteBody}
                  onChange={(v) => {
                    setPasteBody(v);
                    if (v) setFile(null);
                  }}
                  placeholder={t("file.bodyPlaceholder")}
                  rows={8}
                  mono
                />
              </FormField>

              <div style={s.divider}>
                <span style={s.dividerLine} />
                {t("file.orDivider")}
                <span style={s.dividerLine} />
              </div>

              <FormField label={t("file.uploadLabel")}>
                <div
                  style={s.dropZone(dragOver)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Icon.Upload size={20} style={{ color: "var(--text-muted)" }} />
                  <span style={s.dropHint}>{t("file.dropHint")}</span>
                  <Button kind="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                    {t("file.browseButton")}
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_FILE_TYPES}
                    onChange={onFileInputChange}
                    style={{ display: "none" }}
                  />
                </div>
                {file && (
                  <div style={s.selectedFileRow}>
                    <Icon.FileText size={14} />
                    <span style={s.selectedFileName}>{t("file.selectedFile", { name: file.name })}</span>
                    <Badge color="var(--text-muted)" style={{ cursor: "pointer" }}>
                      <span onClick={() => setFile(null)}>{t("file.removeFile")}</span>
                    </Badge>
                  </div>
                )}
              </FormField>

              {importError && <div style={s.errorText}>{importError}</div>}
            </div>
          )}

          {tab === "url" && (
            <div style={s.body}>
              <FormField label={t("url.label")} hint={t("url.hint")}>
                <TextInput value={urlValue} onChange={setUrlValue} placeholder={t("url.placeholder")} />
              </FormField>
              {importError && <div style={s.errorText}>{importError}</div>}
            </div>
          )}

          {tab === "community" && (
            <div style={s.body}>
              <TextInput
                value={communityQuery}
                onChange={setCommunityQuery}
                placeholder={t("community.searchPlaceholder")}
              />

              {communitySkills.isLoading && (
                <div style={s.communityList}>
                  <Skeleton height={64} />
                  <Skeleton height={64} />
                </div>
              )}

              {communitySkills.isError && (
                <ErrorState body={t("community.loadError")} onRetry={() => communitySkills.refetch()} />
              )}

              {!communitySkills.isLoading &&
                !communitySkills.isError &&
                (communitySkills.data?.length ?? 0) === 0 && (
                  <EmptyState icon="Users" title={t("community.noMatch.title")} body={t("community.noMatch.body")} />
                )}

              {!communitySkills.isLoading && !communitySkills.isError && (communitySkills.data?.length ?? 0) > 0 && (
                <div style={s.communityList}>
                  {communitySkills.data!.map((entry) => (
                    <div key={entry.repo} style={s.communityCard}>
                      <div style={s.communityCardMain}>
                        <div style={s.communityCardTitle}>{entry.name}</div>
                        <div style={s.communityCardMeta}>
                          <Icon.Star size={12} />
                          <span>{entry.stars}</span>
                          <span>·</span>
                          <span>{entry.lang}</span>
                          <span>·</span>
                          <span>{entry.repo}</span>
                        </div>
                        <div style={s.communityCardDesc}>{entry.desc}</div>
                      </div>
                      <Button
                        kind="secondary"
                        size="sm"
                        onClick={() => doPreviewCommunity(entry.repo)}
                        disabled={importPreview.isPending}
                      >
                        {importPreview.isPending ? t("community.importing") : t("community.import")}
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {importError && <div style={s.errorText}>{importError}</div>}
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}
