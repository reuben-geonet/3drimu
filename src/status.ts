import type {
  NumericRimuStatus,
  RimuFaultDevice,
  RimuStatus
} from "./types";

const ACK_OVERDUE_SECONDS = 60 * 60 * 24 * 7 * 6;

export const RIMU_STATUSES = [
  "ok",
  "warning",
  "bad",
  "unknown",
  "acknowledged",
  "overdue"
] as const satisfies readonly RimuStatus[];

export const STATUS_LABELS: Record<RimuStatus, string> = {
  ok: "OK",
  warning: "Warning",
  bad: "Bad",
  unknown: "Unknown",
  acknowledged: "Acknowledged",
  overdue: "Overdue"
};

export const STATUS_COLORS: Record<RimuStatus, string> = {
  ok: "#18e68f",
  warning: "#ffd166",
  bad: "#ff3b5f",
  unknown: "#aeb8c7",
  acknowledged: "#7f8fa6",
  overdue: "#ff8f3d"
};

const STATUS_RANK: Record<RimuStatus, number> = {
  ok: 0,
  acknowledged: 1,
  unknown: 1,
  warning: 2,
  overdue: 3,
  bad: 4
};

export function normalizeStatus(status: NumericRimuStatus | number): RimuStatus {
  switch (status) {
    case 1:
      return "ok";
    case 2:
      return "warning";
    case 3:
      return "bad";
    case 5:
      return "acknowledged";
    case 6:
      return "overdue";
    case 4:
    default:
      return "unknown";
  }
}

export function getWorstStatus(statuses: RimuStatus[]): RimuStatus {
  if (statuses.length === 0) {
    return "unknown";
  }

  return statuses.reduce((worst, status) =>
    STATUS_RANK[status] > STATUS_RANK[worst] ? status : worst
  );
}

export function computeLocalityStatus(
  devices: RimuFaultDevice[] | undefined,
  nowSeconds = Date.now() / 1000
): { status: RimuStatus; fieldStatus: Record<string, RimuStatus> } {
  if (!devices || devices.length === 0) {
    return { status: "unknown", fieldStatus: {} };
  }

  const fieldStatuses: Record<string, RimuStatus[]> = {};
  const deviceStatuses: RimuStatus[] = [];

  for (const device of devices) {
    const metrics = device.Metrics ?? {};
    const deviceAck = Number(device.Acknowledged ?? 0);

    for (const metric of Object.values(metrics)) {
      const metricStatus = normalizeStatus(metric.Status);
      const metricAck = Number(metric.Acknowledged ?? 0);
      const acknowledgedAt = deviceAck > 0 ? deviceAck : metricAck;
      const acknowledged = acknowledgedAt > 0;
      let decoratedStatus = metricStatus;

      if (metricStatus !== "ok" && acknowledged) {
        decoratedStatus =
          acknowledgedAt < nowSeconds - ACK_OVERDUE_SECONDS
            ? "overdue"
            : "acknowledged";
      }

      deviceStatuses.push(decoratedStatus);
      fieldStatuses[metric.Field] ??= [];
      fieldStatuses[metric.Field].push(decoratedStatus);
    }
  }

  const summarizedFields = Object.fromEntries(
    Object.entries(fieldStatuses).map(([field, statuses]) => [
      field,
      getWorstStatus(statuses)
    ])
  );

  return {
    status: getWorstStatus(deviceStatuses),
    fieldStatus: summarizedFields
  };
}
