# SQL maintenance notes

v1.6.4 external-ticket policy: local-only tickets (jira_key IS NULL) are no
longer created. Existing local-only rows should be back-filled to Jira via the
platform (or removed manually):

    DELETE FROM jira_tickets WHERE jira_key IS NULL;

Run ad-hoc inside the cluster, never commit .sql dump files (pre-commit guard).
