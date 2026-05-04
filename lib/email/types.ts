export type RelatedEntityType = 'job' | 'offer' | 'inquiry' | 'customer' | 'invoice'

export type EmailAttachmentInput = {
  filename: string
  content: Buffer
  contentType?: string | null
}

export type ThreadStatus = 'open' | 'waiting_customer' | 'waiting_internal' | 'closed'

export type OutboundMessageStatus =
  | 'draft'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'failed'
  | 'cancelled'

export type InboundMatchingStatus = 'matched' | 'fallback_matched' | 'unmatched'

export type MailboxRow = {
  id: string
  company_id: string
  name: string
  email_address: string
  provider_type: string
  is_active: boolean
  is_default_outbound: boolean
  is_default_inbound: boolean
}

export type MessageThreadRow = {
  id: string
  company_id: string
  mailbox_id: string
  related_entity_type: RelatedEntityType
  related_entity_id: string
  customer_id: string | null
  contact_id: string | null
  subject_original: string | null
  subject_normalized: string | null
  status: ThreadStatus
  has_unread_inbound: boolean
  last_message_at: string | null
  last_inbound_at: string | null
  last_outbound_at: string | null
}

export type OutboundMessageRow = {
  id: string
  company_id: string
  mailbox_id: string
  thread_id: string
  related_entity_type: RelatedEntityType
  related_entity_id: string
  customer_id: string | null
  contact_id: string | null
  message_type: string
  to_email: string
  to_name: string | null
  cc: string | null
  bcc: string | null
  reply_to: string | null
  subject_rendered: string
  html_rendered: string | null
  text_rendered: string | null
  provider: string
  provider_message_id: string | null
  internet_message_id: string | null
  tracking_token: string | null
  status: OutboundMessageStatus
  error_code: string | null
  error_message: string | null
  triggered_by_user_id: string | null
  triggered_automatically: boolean
  sent_at: string | null
  created_at?: string | null
}

export type InboundMessageRow = {
  id: string
  company_id: string
  mailbox_id: string
  thread_id: string | null
  related_entity_type: RelatedEntityType | null
  related_entity_id: string | null
  customer_id: string | null
  contact_id: string | null
  from_email: string
  from_name: string | null
  to_email: string | null
  cc: string | null
  subject: string | null
  html_body: string | null
  text_body: string | null
  internet_message_id: string | null
  in_reply_to_message_id: string | null
  references_header: string | null
  provider: string
  provider_message_id: string | null
  matching_status: InboundMatchingStatus
  received_at: string
  is_read: boolean
  created_at?: string | null
}

export type SendTransactionalEmailInput = {
  companyId: string
  mailboxId?: string | null
  relatedEntityType: RelatedEntityType
  relatedEntityId: string
  customerId?: string | null
  contactId?: string | null
  messageType: string
  toEmail: string
  toName?: string | null
  cc?: string | null
  bcc?: string | null
  replyTo?: string | null
  subject: string
  html?: string | null
  text?: string | null
  attachments?: EmailAttachmentInput[]
  triggeredByUserId?: string | null
  triggeredAutomatically?: boolean
}

export type SendTransactionalEmailResult = {
  thread: MessageThreadRow
  outboundMessage: OutboundMessageRow
}

export type FindOrCreateThreadInput = {
  companyId: string
  mailboxId: string
  relatedEntityType: RelatedEntityType
  relatedEntityId: string
  customerId?: string | null
  contactId?: string | null
  subject?: string | null
}

export type NormalizedInboundPayload = {
  companyId: string
  mailboxEmail: string
  provider: string
  providerMessageId?: string | null
  internetMessageId?: string | null
  inReplyToMessageId?: string | null
  referencesHeader?: string | null
  fromEmail: string
  fromName?: string | null
  toEmail?: string | null
  cc?: string | null
  subject?: string | null
  htmlBody?: string | null
  textBody?: string | null
  receivedAt: string
}

export type InboundMatchResult = {
  matchingStatus: InboundMatchingStatus
  threadId: string | null
  relatedEntityType: RelatedEntityType | null
  relatedEntityId: string | null
  customerId: string | null
  contactId: string | null
  mailboxId: string | null
  matchedBy: 'in_reply_to' | 'references' | 'token' | 'fallback' | 'none'
}

export type MessageFeedItem = {
  id: string
  threadId?: string | null
  direction: 'outbound' | 'inbound'
  email: string
  name: string | null
  senderEmail?: string | null
  senderName?: string | null
  senderProfileId?: string | null
  subject: string | null
  preview: string | null
  bodyText?: string | null
  bodyHtml?: string | null
  status: string | null
  happenedAt: string
}
