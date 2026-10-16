"""Course questions answered during admission."""

from __future__ import annotations

from bson import ObjectId
from fastapi import APIRouter, Request

from app.admissions.routes import (
    QuestionBody,
    QuestionPatch,
    _catalog_editor,
    _clean_question,
    _course,
    _merged_question,
    _question_view,
    _questions_for,
    _reader,
    _retire_or_delete,
)
from app.deps import current_user, db, write_audit
from app.errors import AppError

router = APIRouter(prefix="/api/v1")

@router.get("/courses/{course_id}/questions")
async def list_questions(request: Request, course_id: str, include_retired: bool = False) -> dict:
    user = await current_user(request)
    _reader(user)
    await _course(request, user, course_id)
    rows = await _questions_for(request, course_id, include_retired=include_retired)
    return {"items": [_question_view(row) for row in rows]}


@router.post("/courses/{course_id}/questions")
async def create_question(request: Request, course_id: str, body: QuestionBody) -> dict:
    user = await current_user(request)
    _catalog_editor(user)
    await _course(request, user, course_id)
    fields = _clean_question(body)
    taken = await db(request).course_questions.find_one({"course_id": course_id, "label_key": fields["label_key"]})
    if taken:
        raise AppError(409, "question.exists", "This course already has that question.")
    last = await db(request).course_questions.find({"course_id": course_id}).sort("order", -1).to_list(length=1)
    order = (last[0].get("order") or 0) + 1 if last else 1
    question_id = str(ObjectId())
    await db(request).course_questions.insert_one(
        {
            "_id": question_id,
            "institute_id": user["institute_id"],
            "course_id": course_id,
            "order": order,
            **fields,
        }
    )
    await write_audit(
        request, user, "course_question.create", None, {"label": fields["label"]}, {"course_id": course_id}
    )
    return {"id": question_id, "order": order}


@router.patch("/courses/{course_id}/questions/{question_id}")
async def update_question(request: Request, course_id: str, question_id: str, body: QuestionPatch) -> dict:
    user = await current_user(request)
    _catalog_editor(user)
    row = await db(request).course_questions.find_one(
        {"_id": question_id, "course_id": course_id, "institute_id": user["institute_id"]}
    )
    if row is None:
        raise AppError(404, "not_found", "That record was not found.")
    merged = _merged_question(body, row)
    fields = _clean_question(merged, row)
    if body.order is not None:
        if body.order < 1 or body.order > 50:
            raise AppError(422, "intake.field", "Use an order from 1 to 50.", field="order")
        fields["order"] = body.order
    else:
        fields["order"] = row.get("order") or 1
    taken = await db(request).course_questions.find_one(
        {"course_id": course_id, "label_key": fields["label_key"], "_id": {"$ne": question_id}}
    )
    if taken:
        raise AppError(409, "question.exists", "This course already has that question.")
    await db(request).course_questions.update_one({"_id": question_id}, {"$set": fields})
    await write_audit(
        request,
        user,
        "course_question.update",
        {"label": row.get("label") or ""},
        {"label": fields["label"]},
        {"course_id": course_id},
    )
    return {"id": question_id}


@router.delete("/courses/{course_id}/questions/{question_id}")
async def delete_question(request: Request, course_id: str, question_id: str) -> dict:
    user = await current_user(request)
    _catalog_editor(user)
    row = await db(request).course_questions.find_one(
        {"_id": question_id, "course_id": course_id, "institute_id": user["institute_id"]}
    )
    if row is None:
        raise AppError(404, "not_found", "That record was not found.")
    return await _retire_or_delete(
        request, user, "course_questions", question_id, row, "course_question.delete", {"course_id": course_id}
    )


