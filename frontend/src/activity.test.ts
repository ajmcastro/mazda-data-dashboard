import { describe, expect, it } from 'vitest'
import type { ActivityPattern } from './api/types'
import { ACTIVITY_NOTE, MIN_DAYS, busiestHours, hourBars, hourLabel, summaryLine, weekdayBars } from './activity'

const hours = (days: Record<number, number>): ActivityPattern['hours'] =>
  Array.from({ length: 24 }, (_, hour) => ({ hour, active_days: days[hour] ?? 0, warning_codes: 0, km: 0, drives: 0 }))

const pattern = (days: Record<number, number>, weekdays: ActivityPattern['weekdays'] = []): ActivityPattern => ({
  time_zone: 'Europe/Lisbon',
  hours: hours(days),
  weekdays,
})

describe('hour buckets', () => {
  it('label the hour and mark buckets seen on fewer than the minimum days', () => {
    const bars = hourBars(pattern({ 9: 21, 1: 1 }))
    expect(bars).toHaveLength(24)
    expect(hourLabel(9)).toBe('09:00')
    expect(bars[9]).toMatchObject({ label: '09', days: 21, few: false })
    expect(bars[1].few).toBe(true)
    expect(bars[0].few).toBe(false) // no activity at all is not "few"
    expect(MIN_DAYS).toBe(3)
  })

  it('give nothing for an empty period', () => {
    expect(hourBars(undefined)).toEqual([])
    expect(weekdayBars(undefined)).toEqual([])
    expect(summaryLine([], [])).toBeNull()
  })

  it('pick the busiest hours in clock order and ignore thin ones', () => {
    const top = busiestHours(hourBars(pattern({ 14: 28, 11: 31, 13: 30, 9: 21, 2: 2 })))
    expect(top.map((b) => b.hour)).toEqual([11, 13, 14])
  })
})

describe('weekday bars are per day, not per event', () => {
  const wd = (weekday: number, calendar_days: number, active_days: number, km = 0) => ({
    weekday, calendar_days, active_days, warning_days: active_days, km,
  })

  it('divide by the days of that weekday in the period', () => {
    const bars = weekdayBars(pattern({}, [wd(3, 21, 3, 21), wd(6, 22, 19, 570)]))
    expect(bars[0]).toMatchObject({ name: 'Thursday', short: 'Thu', pctOfDays: 14, kmPerDay: 1 })
    expect(bars[1]).toMatchObject({ name: 'Sunday', pctOfDays: 86, kmPerDay: 25.9 })
  })

  it('give null, not zero, for a weekday with no days in the period', () => {
    const [b] = weekdayBars(pattern({}, [wd(2, 0, 0)]))
    expect(b.pctOfDays).toBeNull()
    expect(b.kmPerDay).toBeNull()
  })

  it('mark a weekday with fewer than the minimum days', () => {
    expect(weekdayBars(pattern({}, [wd(1, 2, 1)]))[0].few).toBe(true)
  })
})

describe('the summary sentence', () => {
  it('names the busiest hours and the weekday with the most days, neutrally', () => {
    const p = pattern({ 11: 31, 13: 30, 14: 28 }, [
      { weekday: 3, calendar_days: 21, active_days: 9, warning_days: 9, km: 0 },
      { weekday: 6, calendar_days: 22, active_days: 19, warning_days: 19, km: 0 },
    ])
    const line = summaryLine(hourBars(p), weekdayBars(p))
    expect(line).toBe('Most days with activity fall around 11:00, 13:00 and 14:00. Sundays have activity on 19 of their 22 days.')
    expect(line).not.toMatch(/good|bad|worse|better|risk/i)
  })

  it('says the note does not describe driving style', () => {
    expect(ACTIVITY_NOTE).toMatch(/not how it was driven/)
  })
})
