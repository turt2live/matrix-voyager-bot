import MatrixLiteClient from "./matrix_client_lite";
import config from "../config";

const VoyagerBot = new MatrixLiteClient(config.matrix.homeserverUrl, config.matrix.accessToken);
export default VoyagerBot;