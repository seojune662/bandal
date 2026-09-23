import Foundation
import EventKit
import AppKit

// One JSON request over stdin, one response over stdout. No shell, server, or credentials.
let store = EKEventStore()
let iso = ISO8601DateFormatter()
let day = DateFormatter()
day.calendar = Calendar(identifier: .gregorian)
day.locale = Locale(identifier: "en_US_POSIX")
day.dateFormat = "yyyy-MM-dd"
day.isLenient = false

func authorization() -> String {
    let status = EKEventStore.authorizationStatus(for: .event)
    if #available(macOS 14.0, *) {
        if status == .fullAccess { return "authorized" }
        if status == .writeOnly { return "write-only" }
    }
    switch status {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    default: return "not-determined"
    }
}

func respond(_ value: Any) -> Never {
    let data = (try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])) ?? Data("{\"error\":\"응답을 만들지 못했습니다.\"}".utf8)
    FileHandle.standardOutput.write(data)
    exit(0)
}
func fail(_ message: String) -> Never { respond(["error": message]) }
func color(_ calendar: EKCalendar) -> String {
    guard let c = NSColor(cgColor: calendar.cgColor)?.usingColorSpace(.sRGB) else { return "#7f8c8d" }
    return String(format: "#%02x%02x%02x", Int(c.redComponent * 255), Int(c.greenComponent * 255), Int(c.blueComponent * 255))
}
func snapshot(_ includeCalendars: Bool) -> [String: Any] {
    let calendars: [[String: Any]] = includeCalendars && authorization() == "authorized" ? store.calendars(for: .event).map {
        ["id": $0.calendarIdentifier, "title": $0.title, "source": $0.source.title, "color": color($0), "writable": $0.allowsContentModifications]
    } : []
    return ["authorization": authorization(), "calendars": calendars, "defaultCalendarId": (includeCalendars && authorization() == "authorized" ? store.defaultCalendarForNewEvents?.calendarIdentifier : nil) as Any? ?? NSNull()]
}
func instant(_ value: String) -> Date? {
    if let date = iso.date(from: value) { return date }
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return fractional.date(from: value)
}

guard let request = try? JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as? [String: Any],
      let command = request["command"] as? String else { fail("잘못된 캘린더 요청입니다.") }

if command == "status" { respond(snapshot(request["includeCalendars"] as? Bool ?? false)) }
if command == "connect" {
    let completion: (Bool, Error?) -> Void = { _, error in
        if let error = error { fail(error.localizedDescription) }
        respond(snapshot(true))
    }
    if #available(macOS 14.0, *) { store.requestFullAccessToEvents(completion: completion) }
    else { store.requestAccess(to: .event, completion: completion) }
    RunLoop.main.run()
    exit(0)
}
guard authorization() == "authorized" else { fail("캘린더 접근 권한이 필요합니다. 설정에서 Apple 캘린더를 연결해주세요.") }

if command == "events" {
    guard let from = request["from"] as? String, let to = request["to"] as? String,
          let start = instant(from), let end = instant(to), end > start, end.timeIntervalSince(start) <= 366 * 86400,
          let ids = request["calendarIds"] as? [String] else { fail("조회할 날짜와 캘린더를 확인해주세요.") }
    let calendars = store.calendars(for: .event).filter { ids.contains($0.calendarIdentifier) }
    if calendars.isEmpty { respond([]) } // nil/empty passed to EventKit can mean ALL calendars.
    let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
    let events = store.events(matching: predicate).filter { $0.startDate < end && ($0.endDate > start || ($0.startDate == $0.endDate && $0.startDate >= start)) }
    respond(events.map { event -> [String: Any] in
        let url = event.url?.absoluteString ?? ""
        let prefix = "bandal://calendar/task/"
        return ["id": "\(event.eventIdentifier ?? event.calendarItemIdentifier):\(iso.string(from: event.startDate))",
                "calendarId": event.calendar.calendarIdentifier, "calendarTitle": event.calendar.title,
                "title": event.title ?? "제목 없음", "start": event.isAllDay ? day.string(from: event.startDate) : iso.string(from: event.startDate),
                "end": event.isAllDay ? day.string(from: event.endDate) : iso.string(from: event.endDate),
                "allDay": event.isAllDay, "location": event.location ?? "", "color": color(event.calendar),
                "bandalTaskId": url.hasPrefix(prefix) ? String(url.dropFirst(prefix.count)) as Any : NSNull()]
    })
}
if command == "export" {
    guard let calendarId = request["calendarId"] as? String,
          let calendar = store.calendar(withIdentifier: calendarId), calendar.allowsContentModifications,
          let taskId = request["taskId"] as? String, !taskId.isEmpty,
          let title = request["title"] as? String, !title.isEmpty,
          let startValue = request["start"] as? String,
          let endValue = request["end"] as? String else { fail("저장할 캘린더와 일정의 제목·날짜를 확인해주세요.") }
    let allDay = request["allDay"] as? Bool ?? true
    guard let start = allDay ? day.date(from: startValue) : instant(startValue),
          let end = allDay ? day.date(from: endValue) : instant(endValue),
          allDay ? end > start : end >= start else { fail("날짜 형식이 올바르지 않습니다.") }
    let marker = "bandal://calendar/task/\(taskId)"
    var existing: EKEvent? = nil
    if let id = request["eventId"] as? String, let found = store.event(withIdentifier: id), found.url?.absoluteString == marker {
        existing = found
    }
    // Recover from an identifier changed by iCloud, or an interrupted response after a save.
    if existing == nil {
        let predicate = store.predicateForEvents(withStart: start.addingTimeInterval(-86400), end: start.addingTimeInterval(2 * 86400), calendars: [calendar])
        existing = store.events(matching: predicate).first { $0.url?.absoluteString == marker }
    }
    if let old = existing, old.hasRecurrenceRules { fail("Apple 캘린더에서 반복 일정으로 바뀐 항목은 해당 앱에서 수정해주세요.") }
    let event = existing ?? EKEvent(eventStore: store)
    if existing != nil && !event.calendar.allowsContentModifications { fail("기존 일정의 캘린더가 읽기 전용입니다.") }
    event.calendar = calendar
    event.title = title
    event.notes = request["notes"] as? String ?? ""
    event.url = URL(string: marker)
    event.isAllDay = allDay
    event.startDate = start
    event.endDate = end
    do {
        try store.save(event, span: .thisEvent, commit: true)
        respond(["eventId": event.eventIdentifier ?? event.calendarItemIdentifier, "updated": existing != nil])
    } catch { fail(error.localizedDescription) }
}
fail("지원하지 않는 캘린더 요청입니다.")
