// src/app/chat/chat-inbox.component.ts
import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatService } from '../services/chats/chat';
import { Conversation, Message } from '../interfaces/chats/chat';
import { Subscription, Observable } from 'rxjs';

@Component({
  selector: 'app-chat-inbox',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat-inbox.html',
  styleUrls: ['./chat-inbox.css'],
})
export class ChatInboxComponent implements OnInit, OnDestroy {
  conversations: Conversation[] = [];
  conversationsSub?: Subscription;
  messages$?: Observable<Message[]>;
  selectedConv?: Conversation | null = null;
  dockOpen = false;
  slideOpen = false;
  fullScreen = false;
  composerText = '';
  quickTemplates = [
    { name: 'Confirmación reserva', text: 'Hola {{name}}, tu reserva ha sido confirmada. Código: {{id}}' },
    { name: 'Recordatorio', text: 'Recordatorio: su tour es mañana a las {{hora}}. Gracias.' }
  ];

  // reservation form state (simple)
  showReservationForm = false;
  reservationForm: any = {
    tour: 'Guatapé - Mañana',
    date: '',
    passengers: 1,
    contactName: '',
    phone: ''
  };
get unreadCount(): number {
  return this.conversations.reduce((acc, c) => acc + (c.unread || 0), 0);
}

  constructor(private chat: ChatService) {}

  ngOnInit(): void {
    this.conversationsSub = this.chat.getConversations().subscribe(cs => this.conversations = cs);
    // keyboard shortcut: Ctrl/Cmd + K opens dock
    window.addEventListener('keydown', this.onKeydown);
  }

  ngOnDestroy(): void {
    this.conversationsSub?.unsubscribe();
    window.removeEventListener('keydown', this.onKeydown);
  }

  private onKeydown = (ev: KeyboardEvent) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      this.toggleDock();
    }
    if (ev.key === 'Escape') {
      this.closeSlide();
    }
  };

  toggleDock() {
    this.dockOpen = !this.dockOpen;
    if (!this.dockOpen) {
      this.closeSlide();
    }
  }

  openConversation(conv: Conversation) {
    this.selectedConv = conv;
    this.slideOpen = true;
    this.fullScreen = false;
    this.messages$ = this.chat.getMessages(conv.id);
    this.chat.markAsRead(conv.id);
    // prefill reservation contact if opening reservation later
    this.reservationForm.contactName = conv.contactName;
    this.reservationForm.phone = conv.phone;
  }

  closeSlide() {
    this.slideOpen = false;
    this.selectedConv = null;
    this.messages$ = undefined;
    this.showReservationForm = false;
  }

  togglePin(conv: Conversation) {
    const newArr = this.conversations.map(c => c.id === conv.id ? { ...c, pinned: !c.pinned } : c);
    // cheap update by using ChatService internal BehaviorSubject (we don't expose a direct update method in mock)
    // For production, implement an updateConversation method in ChatService
    (this.chat as any).convs$?.next(newArr);
  }

  sendMessage() {
    if (!this.selectedConv || !this.composerText.trim()) return;
    this.chat.sendMessage(this.selectedConv.id, this.composerText.trim()).subscribe();
    this.composerText = '';
    // auto-scroll: the template uses a #messagesList element; you could call scrollToBottom here using ViewChild
  }

  useTemplate(tpl: string) {
    // simple insertion
    this.composerText = tpl;
  }

  openReservationFromChat() {
    this.showReservationForm = true;
    // ensure contact prefilled
    if (this.selectedConv) {
      this.reservationForm.contactName = this.selectedConv.contactName;
      this.reservationForm.phone = this.selectedConv.phone;
    }
  }

  createReservation() {
    // fake reservation id
    const id = 'R-' + Math.floor(Math.random() * 1000000);
    if (!this.selectedConv) return;
    this.chat.linkReservation(this.selectedConv.id, id);
    // send a confirmation message (this will simulate status etc)
    this.chat.sendMessage(this.selectedConv.id, `Reserva creada: ${id} — Tour: ${this.reservationForm.tour} - Fecha: ${this.reservationForm.date}`);
    this.showReservationForm = false;
  }

  toggleFullScreen() {
    this.fullScreen = !this.fullScreen;
  }
}
