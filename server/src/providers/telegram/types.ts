/** Sous-ensemble des types de l'API Bot Telegram utilisés par TeleDesk (noms de champs identiques à la doc officielle). */
export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  /** Renvoyé par getMe : le bot peut être connecté à un compte Business. */
  can_connect_to_business?: boolean;
}
export interface TgChat { id: number; type: 'private' | 'group' | 'supergroup' | 'channel'; first_name?: string; last_name?: string; username?: string }
export interface TgPhotoSize { file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }
export interface TgFileInfo { file_id: string; file_unique_id: string; file_size?: number; file_name?: string; mime_type?: string; duration?: number; width?: number; height?: number }
export interface TgMessage {
  message_id: number;
  date: number;
  edit_date?: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
  video?: TgFileInfo;
  audio?: TgFileInfo;
  voice?: TgFileInfo;
  document?: TgFileInfo;
  sticker?: TgFileInfo & { emoji?: string };
  business_connection_id?: string;
  /** Présent quand le message a été envoyé par un bot Business au nom du titulaire. */
  sender_business_bot?: TgUser;
  is_from_offline?: boolean;
  reply_to_message?: { message_id: number };
}
export interface TgBusinessRights {
  can_reply?: boolean;
  can_read_messages?: boolean;
  can_delete_sent_messages?: boolean;
  can_delete_all_messages?: boolean;
}
export interface TgBusinessConnection {
  id: string;
  user: TgUser;
  user_chat_id: number;
  date: number;
  is_enabled: boolean;
  rights?: TgBusinessRights;
  /** Ancien champ (avant l'API 9.0), remplacé par rights.can_reply. */
  can_reply?: boolean;
}
export interface TgBusinessMessagesDeleted { business_connection_id: string; chat: TgChat; message_ids: number[] }
export interface TgChatMemberUpdated { chat: TgChat; from: TgUser; date: number; new_chat_member: { status: string; user: TgUser } }
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  business_connection?: TgBusinessConnection;
  business_message?: TgMessage;
  edited_business_message?: TgMessage;
  deleted_business_messages?: TgBusinessMessagesDeleted;
  my_chat_member?: TgChatMemberUpdated;
}
export const ALLOWED_UPDATES = ['message', 'business_connection', 'business_message', 'edited_business_message', 'deleted_business_messages', 'my_chat_member'] as const;
