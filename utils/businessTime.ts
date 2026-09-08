export const BUSINESS_TIME_ZONE = 'Asia/Amman';

const monthFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
});

/** المفتاح المحاسبي للطلبات حسب التقويم المحلي للأردن، لا حسب UTC. */
export const getBusinessMonthKey = (value: Date | string | number = new Date()): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Invalid business date');

  const parts = Object.fromEntries(
    monthFormatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}`;
};

export default { BUSINESS_TIME_ZONE, getBusinessMonthKey };
