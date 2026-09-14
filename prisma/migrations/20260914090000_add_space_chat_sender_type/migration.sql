-- Adds SPACE as a valid ChatSenderType so Space Partners can participate as chat senders in
-- Sponsorship Chat threads (when a Brand marks interest on a Space-owned SponsorshipProposal).
-- Must be its own standalone migration — Postgres forbids using a newly added enum value in the
-- same transaction that adds it.
ALTER TYPE "ChatSenderType" ADD VALUE 'SPACE';
