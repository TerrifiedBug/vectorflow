type SourceRateSample = {
  receivedEventsRate: number;
  sentEventsRate: number;
  receivedBytesRate: number;
  sentBytesRate: number;
};

export function sourceEventsRate(sample: SourceRateSample): number {
  return sample.receivedEventsRate > 0 ? sample.receivedEventsRate : sample.sentEventsRate;
}

export function sourceBytesRate(sample: SourceRateSample): number {
  return sample.receivedBytesRate > 0 ? sample.receivedBytesRate : sample.sentBytesRate;
}
