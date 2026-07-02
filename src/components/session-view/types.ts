// 会话消息的规范化结构——桌面与远程面板共用同一套渲染组件，故类型集中在此。
// 注意：read_session_messages（Rust）与远程 /api/task/<id>/history 的输出都需对齐此 shape。

export interface SessionImageSource {
  type: "base64";
  media_type: string;
  data: string;
}

export interface SessionContent {
  type: "text" | "tool_use" | "thinking" | "image" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: string;
  thinking?: string;
  // 多模态图片
  source?: SessionImageSource;
  // 工具结果（可嵌套）
  tool_use_id?: string;
  content?: SessionContent[];
}

export interface SessionMessage {
  role: "user" | "assistant";
  content: SessionContent[];
  /** 消息创建时间戳（毫秒），可能缺失。 */
  created_at?: number;
}
