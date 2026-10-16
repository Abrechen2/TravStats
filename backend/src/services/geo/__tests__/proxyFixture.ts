// Local-only integration fixture, never mounted by the application.
import express from "express";
import geoServer from "../../../routes/geoServer";
import { assetPathGuard } from "../../../middleware/assetPathGuard";
const app = express();
app.use("/api", assetPathGuard);
app.use("/api/v1/geo-server", geoServer);
app.listen(18444, "127.0.0.1", () => process.stdout.write("ready\n"));
