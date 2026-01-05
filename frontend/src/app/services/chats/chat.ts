// src/app/chat/chat.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, interval, Observable, of } from 'rxjs';
import { Conversation, Message } from '../../interfaces/chats/chat';
import { map } from 'rxjs/operators';
// import { v4 as uuid } from 'uuid';

/**
 * Servicio mock. Emula:
 * - lista de conversaciones (BehaviorSubject)
 * - mensajes por conversación (BehaviorSubject)
 * - envíos y simulación de respuesta/estado
 *
 * Reemplaza este servicio por uno que use tus WebSockets reales (mantén las APIs):
 * - getConversations(): Observable<Conversation[]>
 * - getMessages(conversationId): Observable<Message[]>
 * - sendMessage(conversationId, text)
 * - linkReservation(conversationId, reservationId)
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private convs$ = new BehaviorSubject<Conversation[]>([
    {
      id: 'c1',
      channel: 'whatsapp',
      contactName: 'María Gómez',
      phone: '+57 300 1234567',
      lastMessage: '¿Qué horarios hay para Guatapé?',
      lastAt: new Date().toISOString(),
      unread: 2,
      pinned: false,
      reservationId: null
    },
    {
      id: 'c2',
      channel: 'instagram',
      contactName: 'Andrés López',
      phone: '+57 310 9876543',
      lastMessage: '¿Tienen cupo para mañana?',
      lastAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
      unread: 0,
      pinned: false,
      reservationId: null
    },
    {
      id: 'c3',
      channel: 'facebook',
      contactName: 'Hotel El Paraíso',
      phone: '+57 320 2223344',
      lastMessage: 'Necesitamos 5 cupos para el 24',
      lastAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
      unread: 1,
      pinned: true,
      reservationId: null
    }
  ]);

  // messages map
  private messagesMap = new Map<string, BehaviorSubject<Message[]>>();

  constructor() {
    // seed messages
    this.convSeedMessages('c1', [
      { id: Date.now().toString() + Math.random(), conversationId: 'c1', direction: 'in', text: 'Hola, ¿qué horarios hay para Guatapé?', createdAt: new Date(Date.now() - 1000 * 60 * 10).toISOString(), status: 'read' },
      { id: Date.now().toString() + Math.random(), conversationId: 'c1', direction: 'in', text: 'Somos 3 adultos', createdAt: new Date(Date.now() - 1000 * 60 * 9).toISOString(), status: 'read' }
    ]);
    this.convSeedMessages('c2', [
      { id: Date.now().toString() + Math.random(), conversationId: 'c2', direction: 'in', text: '¿Tienen cupo?', createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(), status: 'delivered' }
    ]);
    this.convSeedMessages('c3', [
      { id: Date.now().toString() + Math.random(), conversationId: 'c3', direction: 'in', text: 'Necesitamos 5 cupos para el 24', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), status: 'delivered' }
    ]);

    // simulate incoming messages occasionally
    interval(20000).subscribe(() => this.simulateIncoming());
  }

  private convSeedMessages(convId: string, msgs: Message[]) {
    this.messagesMap.set(convId, new BehaviorSubject<Message[]>(msgs));
  }

  getConversations(): Observable<Conversation[]> {
    return this.convs$.asObservable();
  }

  getMessages(conversationId: string): Observable<Message[]> {
    if (!this.messagesMap.has(conversationId)) {
      this.messagesMap.set(conversationId, new BehaviorSubject<Message[]>([]));
    }
    return this.messagesMap.get(conversationId)!.asObservable();
  }

  sendMessage(conversationId: string, text: string): Observable<Message> {
    const msg: Message = {
      id: Date.now().toString() + Math.random(),
      conversationId,
      direction: 'out',
      text,
      createdAt: new Date().toISOString(),
      status: 'sending'
    };
    const subj = this.ensureConvMessages(conversationId);
    subj.next([...subj.value, msg]);
    this.updateConversationLast(conversationId, text, 0);

    // simulate status progression
    setTimeout(() => this.updateMessageStatus(conversationId, msg.id, 'sent'), 400);
    setTimeout(() => this.updateMessageStatus(conversationId, msg.id, 'delivered'), 800);
    setTimeout(() => this.updateMessageStatus(conversationId, msg.id, 'read'), 1500);

    // simulate an inbound reply (optional)
    setTimeout(() => {
      const reply: Message = {
        id: Date.now().toString() + Math.random(),
        conversationId,
        direction: 'in',
        text: 'Perfecto, lo reviso y te confirmo.',
        createdAt: new Date().toISOString(),
        status: 'delivered'
      };
      const s = this.ensureConvMessages(conversationId);
      s.next([...s.value, reply]);
      this.incrementUnread(conversationId);
      this.updateConversationLast(conversationId, reply.text, 1);
    }, 2500 + Math.random() * 3000);

    return of(msg);
  }

  private ensureConvMessages(convId: string) {
    if (!this.messagesMap.has(convId)) this.messagesMap.set(convId, new BehaviorSubject<Message[]>([]));
    return this.messagesMap.get(convId)!;
  }

  private updateMessageStatus(conversationId: string, messageId: string, status: Message['status']) {
    const subj = this.messagesMap.get(conversationId);
    if (!subj) return;
    const arr = subj.value.map(m => (m.id === messageId ? { ...m, status } : m));
    subj.next(arr);
  }

  private updateConversationLast(conversationId: string, lastMessage: string, unreadDelta = 0) {
    const arr = this.convs$.value.map(c => {
      if (c.id === conversationId) {
        return { ...c, lastMessage, lastAt: new Date().toISOString(), unread: Math.max(0, c.unread + unreadDelta) };
      }
      return c;
    }).sort((a,b) => (new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime()));
    this.convs$.next(arr);
  }

  markAsRead(conversationId: string) {
    const arr = this.convs$.value.map(c => (c.id === conversationId ? { ...c, unread: 0 } : c));
    this.convs$.next(arr);
  }

  linkReservation(conversationId: string, reservationId: string) {
    const arr = this.convs$.value.map(c => (c.id === conversationId ? { ...c, reservationId } : c));
    this.convs$.next(arr);
  }

  private incrementUnread(conversationId: string) {
    const arr = this.convs$.value.map(c => (c.id === conversationId ? { ...c, unread: c.unread + 1 } : c));
    this.convs$.next(arr);
  }

  private simulateIncoming() {
    const convs = this.convs$.value;
    if (!convs.length) return;
    const idx = Math.floor(Math.random() * convs.length);
    const conv = convs[idx];
    const msg: Message = {
      id: Date.now().toString() + Math.random(),
      conversationId: conv.id,
      direction: 'in',
      text: this.randomIncomingText(),
      createdAt: new Date().toISOString(),
      status: 'delivered'
    };
    const subj = this.ensureConvMessages(conv.id);
    subj.next([...subj.value, msg]);
    this.updateConversationLast(conv.id, msg.text, 1);
  }

  private randomIncomingText() {
    const pool = [
      '¿Pueden confirmar hora?',
      '¿Incluye transporte?',
      'Necesito factura por favor.',
      '¿Aceptan niños?',
      '¿Hay descuento para grupos?'
    ];
    return pool[Math.floor(Math.random() * pool.length)];
  }
}
