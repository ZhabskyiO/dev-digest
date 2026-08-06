"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  Modal,
  FormField,
  TextInput,
  SelectInput,
  SearchableSelect,
  Textarea,
} from "@devdigest/ui";
import type { Provider } from "@devdigest/shared";
import { useCreateAgent, useProviderModels } from "../../../../../../lib/hooks/agents";
import { toModelOptions } from "../../../../../../lib/model-label";
import { DEFAULT_MODEL, DEFAULT_PROVIDER, MODAL_WIDTH, PROVIDER_OPTIONS } from "./constants";
import { s } from "./styles";

/** Create-agent modal — name/description/provider/model/system-prompt. */
export function CreateAgentModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("agents");
  const router = useRouter();
  const create = useCreateAgent();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [provider, setProvider] = React.useState<Provider>(DEFAULT_PROVIDER);
  const [model, setModel] = React.useState(DEFAULT_MODEL);
  const [systemPrompt, setSystemPrompt] = React.useState(t("create.defaultSystemPrompt"));

  // Same model picker as the editor's Config tab: live list from the provider's
  // /models, with the price (USD per 1M in/out tokens) in the label when the
  // provider exposes it (OpenRouter); the value stays the bare model id.
  const { data: models } = useProviderModels(provider);
  const modelOptions = toModelOptions(models);
  const missingModel =
    model !== "" && !modelOptions.some((o) => (typeof o === "string" ? o : o.value) === model);
  // Keep DEFAULT_MODEL selectable while the first fetch is still in flight.
  if (missingModel) modelOptions.unshift(model);
  // Empty list after load = provider key missing/invalid (listModels failed) —
  // guide the user instead of showing a silent empty dropdown.
  const noModels = models !== undefined && models.length === 0;

  // Switching provider drops the model: nothing server-side rejects an
  // openai id saved under `anthropic`, it just fails later at review time.
  const pickProvider = (v: string) => {
    setProvider(v as Provider);
    setModel("");
  };

  const submit = async () => {
    const agent = await create.mutateAsync({
      name: name.trim() || t("create.defaultName"),
      description,
      provider,
      model,
      system_prompt: systemPrompt,
    });
    onClose();
    router.push(`/agents/${agent.id}?tab=config`);
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("create.title")}
      subtitle={t("create.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("create.cancel")}
          </Button>
          <Button kind="primary" icon="Plus" onClick={submit} disabled={create.isPending || !model}>
            {create.isPending ? t("create.creating") : t("create.create")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <FormField label={t("create.fields.name")} required>
          <TextInput value={name} onChange={setName} placeholder={t("create.fields.namePlaceholder")} />
        </FormField>
        <FormField label={t("create.fields.description")}>
          <TextInput
            value={description}
            onChange={setDescription}
            placeholder={t("create.fields.descriptionPlaceholder")}
          />
        </FormField>
        <FormField label={t("create.fields.provider")}>
          <SelectInput value={provider} onChange={pickProvider} options={[...PROVIDER_OPTIONS]} />
        </FormField>
        <FormField
          label={t("create.fields.model")}
          hint={
            noModels
              ? t("create.fields.modelEmptyHint", { provider })
              : t("create.fields.modelHint")
          }
        >
          <SearchableSelect
            value={model}
            onChange={setModel}
            options={modelOptions}
            placeholder={t("create.fields.modelSearch")}
          />
        </FormField>
        <FormField label={t("create.fields.systemPrompt")}>
          <Textarea value={systemPrompt} onChange={setSystemPrompt} rows={6} mono />
        </FormField>
      </div>
    </Modal>
  );
}
