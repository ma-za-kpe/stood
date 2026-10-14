CREATE INDEX "upload_sessions_cleanup_due" ON "upload_sessions" USING btree ("expires_at","id") WHERE "upload_sessions"."status" = 'OPEN';
