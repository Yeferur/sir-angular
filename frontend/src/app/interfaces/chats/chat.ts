// src/app/chat/chat.model.ts
export interface Conversation {
  id: string;
  channel: 'whatsapp' | 'instagram' | 'facebook';
  contactName: string;
  phone?: string;
  lastMessage: string;
  lastAt: string; // ISO
  unread: number;
  pinned?: boolean;
  reservationId?: string | null;
}

export interface Message {
  id: string;
  conversationId: string;
  direction: 'in' | 'out';
  text: string;
  createdAt: string; // ISO
  status?: 'sending' | 'sent' | 'delivered' | 'read';
}
