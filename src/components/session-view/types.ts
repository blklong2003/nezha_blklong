// 会话消息的规范化结构——桌面与远程面板共用同一套渲染组件，故类型集中在此。
// 注意：read_session_messages（Rust）与远程 /api/task/<id>/history 的输出都需对齐此 shape。

export interface SessionContent {
  type: "text" | "tool_use" | "thinking";
  text?: string;
  id?: string;
  name?: string;
  input?: string;
  thinking?: string;
}

export interface SessionMessage {
  role: "user" | "assistant";
  content: SessionContent[];
  /** 消息创建时间戳（毫秒），可能缺失。 */
  created_at?: number;
}
