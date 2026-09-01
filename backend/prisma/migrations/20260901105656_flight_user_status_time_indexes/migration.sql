-- CreateIndex
CREATE INDEX "flights_user_id_status_departure_time_idx" ON "flights"("user_id", "status", "departure_time");

-- CreateIndex
CREATE INDEX "flights_user_id_departure_time_idx" ON "flights"("user_id", "departure_time");
