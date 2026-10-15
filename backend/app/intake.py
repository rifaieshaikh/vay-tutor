"""Compatibility imports. Admission routes live in app.admissions."""

from app.admissions.routes import (
    applied_intake_course,
    apply_course_profiles,
    apply_record_update,
    enquiry_awaiting_follow_up,
    intake_course_visible,
    remember_answers,
    student_extras,
)

__all__ = [
    "applied_intake_course",
    "apply_course_profiles",
    "apply_record_update",
    "enquiry_awaiting_follow_up",
    "intake_course_visible",
    "remember_answers",
    "student_extras",
]
