import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, Zap } from "lucide-react";
import * as Select from "@radix-ui/react-select";
import type { AgentType } from "../../types";
import { useI18n } from "../../i18n";
import s from "../../styles";

interface CcSwitchProvider {
  id: string;
  name: string;
}

function setMenuItemHover(el: HTMLElement, hover: boolean) {
  el.style.background = hover ? "var(--accent-subtle)" : "transparent";
}

export function ProviderSelector({
  agent,
  providerId,
  onSetProviderId,
}: {
  agent: AgentType;
  providerId: string;
  onSetProviderId: (id: string) => void;
}) {
  const { t } = useI18n();
  const [providers, setProviders] = useState<CcSwitchProvider[]>([]);

  useEffect(() => {
    let cancelled = false;
    invoke<CcSwitchProvider[]>("list_cc_switch_providers", { agent })
      .then((list) => { if (!cancelled) setProviders(list); })
      .catch(() => { if (!cancelled) setProviders([]); });
    return () => { cancelled = true; };
  }, [agent]);

  if (providers.length === 0) return null;

  const selected = providers.find((p) => p.id === providerId);
  const label = selected ? selected.name : t("running.providerDefault");

  const selectValue = providerId || "__none__";

  function handleValueChange(val: string) {
    onSetProviderId(val === "__none__" ? "" : val);
  }

  return (
    <Select.Root value={selectValue} onValueChange={handleValueChange}>
      <Select.Trigger style={s.toolbarBtn} aria-label={t("running.switchProvider")}>
        <Zap size={13} strokeWidth={2} color="var(--text-muted)" />
        <span style={{ maxWidth: 96, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
        <Select.Icon>
          <ChevronDown size={12} strokeWidth={2.5} style={{ opacity: 0.58 }} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content position="popper" sideOffset={6} style={s.toolbarMenuContent}>
          <Select.Viewport>
            <Select.Item
              value="__none__"
              style={s.toolbarMenuItem}
              onFocus={(e) => setMenuItemHover(e.currentTarget, true)}
              onBlur={(e) => setMenuItemHover(e.currentTarget, false)}
              onMouseEnter={(e) => setMenuItemHover(e.currentTarget, true)}
              onMouseLeave={(e) => setMenuItemHover(e.currentTarget, false)}
            >
              <Select.ItemText>{t("running.providerDefault")}</Select.ItemText>
            </Select.Item>
            {providers.map((p) => (
              <Select.Item
                key={p.id}
                value={p.id}
                style={s.toolbarMenuItem}
                onFocus={(e) => setMenuItemHover(e.currentTarget, true)}
                onBlur={(e) => setMenuItemHover(e.currentTarget, false)}
                onMouseEnter={(e) => setMenuItemHover(e.currentTarget, true)}
                onMouseLeave={(e) => setMenuItemHover(e.currentTarget, false)}
              >
                <Select.ItemText>{p.name}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
