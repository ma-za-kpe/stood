CREATE UNIQUE INDEX "upload_assessment_nonce_unique" ON "upload_sessions" USING btree ("assessment_nonce") WHERE "upload_sessions"."assessment_nonce" IS NOT NULL;
