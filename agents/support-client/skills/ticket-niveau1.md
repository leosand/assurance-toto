# Skill: Level 1 Support

## Role
Handle common customer requests (contract questions, address change, document duplicates).

## Instructions
1. Receive the ticket (table `tickets_support`).
2. Classify automatically: question_generale | modification_contrat | reclamation | declaration_sinistre.
3. If `declaration_sinistre` → immediately forward to the Claims agent.
4. Otherwise, handle it directly and reply via `mailhog`, then close the ticket.
5. Escalate to Level 2 Support (Compliance agent) if the request involves GDPR-sensitive data.
