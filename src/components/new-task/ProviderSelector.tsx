import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, Zap, Loader2 } from "lucide-react";
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    invoke<CcSwitchProvider[]>("list_cc_switch_providers", { agent })
      .then((list) => { if (!cancelled) setProviders(list); })
      .catch(() => { if (!cancelled) setProviders([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [agent]);

  // 加载中显示 spinner（保持布局稳定）
  if (loading) {
    return (
      <div style={{ padding: "0 14px 8px" }}>
        <div style={{
          ...s.toolbarBtn,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "var(--text-hint)",
          cursor: "default",
        }}>
          <Loader2 size={13} strokeWidth={2} className="spin" style={{ animation: "spin 1s linear infinite" }} />
          <span style={{ fontSize: 12 }}>{t("common.loading")}</span>
        </div>
      </div>
    );
  }

  if (providers.length === 0) return null;

  // 校验当前 providerId 是否仍存在于列表中
  const selected = providers.find((p) => p.id === providerId);
  const isOrphaned = providerId && !selected;
  const label = selected ? selected.name : (isOrphaned ? `⚠️ ${t("running.providerMissing")}` : t("running.providerDefault"));

  const selectValue = providerId || "__none__";

  function handleValueChange(val: string) {
    onSetProviderId(val === "__none__" ? "" : val);
  }

  return (
    <div style={{ padding: "0 14px 8px" }}>
      <Select.Root value={selectValue} onValueChange={handleValueChange}>
        <Select.Trigger style={{
          ...s.toolbarBtn,
          ...(isOrphaned ? { borderColor: "var(--warning)", borderStyle: "dashed" } : {}),
        }} aria-label={t("running.switchProvider")}>
          <Zap size={13} strokeWidth={2} color={isOrphaned ? "var(--warning)" : "var(--text-muted)"} />
          <span style={{
            maxWidth: 96,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: isOrphaned ? "var(--warning)" : undefined,
          }}>
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
              {isOrphaned && providerId && (
                <Select.Item
                  value={providerId}
                  style={{ ...s.toolbarMenuItem, color: "var(--warning)" }}
                  onFocus={(e) => setMenuItemHover(e.currentTarget, true)}
                  onBlur={(e) => setMenuItemHover(e.currentTarget, false)}
                  onMouseEnter={(e) => setMenuItemHover(e.currentTarget, true)}
                  onMouseLeave={(e) => setMenuItemHover(e.currentTarget, false)}
                >
                  <Select.ItemText>⚠️ {providerId} ({t("running.providerMissing")})</Select.ItemText>
                </Select.Item>
              )}
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
    </div>
  );
}
