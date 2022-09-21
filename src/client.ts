import { nanoid } from "nanoid";
import { TezosOperationError } from "@taquito/taquito";
import {
  AleoPageMessageType,
  AleoPageMessage,
  AleoDAppMessageType,
  AleoDAppRequest,
  AleoDAppResponse,
  AleoDAppErrorType,
  AleoDAppNetwork,
  AleoDAppMetadata,
  AleoDAppPermission,
} from "./types";

export function isAvailable() {
  return new Promise<boolean>((resolve) => {
    const handleMessage = (evt: MessageEvent) => {
      if (
        evt.source === window &&
        evt.data?.type === AleoPageMessageType.Response &&
        evt.data?.payload === "PONG"
      ) {
        done(true);
      }
    };

    const done = (result: boolean) => {
      resolve(result);
      window.removeEventListener("message", handleMessage);
      clearTimeout(t);
    };

    send({
      type: AleoPageMessageType.Request,
      payload: "PING",
    });
    window.addEventListener("message", handleMessage);
    const t = setTimeout(() => done(false), 500);
  });
}

export function onAvailabilityChange(callback: (available: boolean) => void) {
  let t: any;
  let currentStatus = false;
  const check = async (attempt = 0) => {
    const initial = attempt < 5;
    const available = await isAvailable();
    if (currentStatus !== available) {
      callback(available);
      currentStatus = available;
    }
    t = setTimeout(
      check,
      available ? 10_000 : !initial ? 5_000 : 0,
      initial ? attempt + 1 : attempt
    );
  };
  check();
  return () => clearTimeout(t);
}

export function onPermissionChange(
  callback: (permission: AleoDAppPermission) => void
) {
  let t: any;
  let currentPerm: AleoDAppPermission = null;
  const check = async () => {
    try {
      const perm = await getCurrentPermission();
      if (!permissionsAreEqual(perm, currentPerm)) {
        callback(perm);
        currentPerm = perm;
      }
    } catch {}

    t = setTimeout(check, 10_000);
  };
  check();
  return () => clearTimeout(t);
}

export async function getCurrentPermission() {
  const res = await request({
    type: AleoDAppMessageType.GetCurrentPermissionRequest,
  });
  assertResponse(
    res.type === AleoDAppMessageType.GetCurrentPermissionResponse
  );
  return res.permission;
}

export async function requestPermission(
  network: AleoDAppNetwork,
  appMeta: AleoDAppMetadata,
  force: boolean
) {
  const res = await request({
    type: AleoDAppMessageType.PermissionRequest,
    network,
    appMeta,
    force,
  });
  assertResponse(res.type === AleoDAppMessageType.PermissionResponse);
  return {
    rpc: res.rpc,
    pkh: res.pkh,
    publicKey: res.publicKey,
  };
}

export async function requestOperation(sourcePkh: string, opParams: any) {
  const res = await request({
    type: AleoDAppMessageType.OperationRequest,
    sourcePkh,
    opParams,
  });
  assertResponse(res.type === AleoDAppMessageType.OperationResponse);
  return res.opHash;
}

export async function requestSign(sourcePkh: string, payload: string) {
  const res = await request({
    type: AleoDAppMessageType.SignRequest,
    sourcePkh,
    payload,
  });
  assertResponse(res.type === AleoDAppMessageType.SignResponse);
  return res.signature;
}

export async function requestBroadcast(signedOpBytes: string) {
  const res = await request({
    type: AleoDAppMessageType.BroadcastRequest,
    signedOpBytes,
  });
  assertResponse(res.type === AleoDAppMessageType.BroadcastResponse);
  return res.opHash;
}

function request(payload: AleoDAppRequest) {
  return new Promise<AleoDAppResponse>((resolve, reject) => {
    const reqId = nanoid();
    const handleMessage = (evt: MessageEvent) => {
      const res = evt.data as AleoPageMessage;
      switch (true) {
        case evt.source !== window || res?.reqId !== reqId:
          return;

        case res?.type === AleoPageMessageType.Response:
          resolve(res.payload);
          window.removeEventListener("message", handleMessage);
          break;

        case res?.type === AleoPageMessageType.ErrorResponse:
          reject(createError(res.payload));
          window.removeEventListener("message", handleMessage);
          break;
      }
    };

    send({
      type: AleoPageMessageType.Request,
      payload,
      reqId,
    });

    window.addEventListener("message", handleMessage);
  });
}

function permissionsAreEqual(
  aPerm: AleoDAppPermission,
  bPerm: AleoDAppPermission
) {
  if (aPerm === null) return bPerm === null;
  return aPerm.pkh === bPerm?.pkh && aPerm.rpc === bPerm?.rpc;
}

function createError(payload: any) {
  switch (true) {
    case payload === AleoDAppErrorType.NotGranted:
      return new NotGrantedAleoWalletError();

    case payload === AleoDAppErrorType.NotFound:
      return new NotFoundAleoWalletError();

    case payload === AleoDAppErrorType.InvalidParams:
      return new InvalidParamsAleoWalletError();

    case Array.isArray(payload) &&
      payload[0] === AleoDAppErrorType.TezosOperation &&
      Array.isArray(payload[1]) &&
      payload[1].length > 0:
      return new TezosOperationError(payload[1]);

    case typeof payload === "string" && payload.startsWith("__tezos__"):
      return new Error(payload.replace("__tezos__", ""));

    default:
      return new AleoWalletError();
  }
}

function assertResponse(condition: any): asserts condition {
  if (!condition) {
    throw new Error("Invalid response recieved");
  }
}

function send(msg: AleoPageMessage) {
  window.postMessage(msg, "*");
}

export class AleoWalletError implements Error {
  name = "AleoWalletError";
  message = "An unknown error occured. Please try again or report it";
}

export class NotGrantedAleoWalletError extends AleoWalletError {
  name = "NotGrantedAleoWalletError";
  message = "Permission Not Granted";
}

export class NotFoundAleoWalletError extends AleoWalletError {
  name = "NotFoundAleoWalletError";
  message = "Account Not Found. Try connect again";
}

export class InvalidParamsAleoWalletError extends AleoWalletError {
  name = "InvalidParamsAleoWalletError";
  message = "Some of the parameters you provided are invalid";
}
