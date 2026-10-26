from app.reporting import describe_part, exam_columns


def test_part_label_names_the_partition():
    papers = {"paper-1": "Journal"}
    units = {"mod-1": "Costing", "mod-2": "Ledgers"}
    labels = {"module": "Module", "part": "Part"}
    assert describe_part("acct", "subject", "", {"kind": "subject", "item_ids": []}, papers, units, labels) == (
        "acct|subject",
        "Whole subject",
    )
    assert describe_part("acct", "unit", "paper-1", {}, papers, units, labels) == (
        "acct|paper|paper-1",
        "Journal",
    )
    assert describe_part("acct", "module", "", {"kind": "module", "item_ids": ["mod-1"]}, papers, units, labels) == (
        "acct|module|mod-1",
        "Module: Costing",
    )
    assert describe_part(
        "acct", "part", "", {"kind": "part", "item_ids": ["mod-1", "mod-2"]}, papers, units, {"part": "Part"},
    ) == ("acct|part|mod-1|mod-2", "Part: Costing, Ledgers")


def test_exam_columns_follow_weight_and_stop_at_five():
    types = [
        {"key": "late", "label": "Late", "weight": 9},
        {"key": "first", "label": "First", "weight": 1},
        {"key": "second", "label": "Second", "weight": 2},
        {"key": "third", "label": "Third", "weight": 3},
        {"key": "fourth", "label": "Fourth", "weight": 4},
        {"key": "fifth", "label": "Fifth", "weight": 5},
    ]
    rows = [{"exam_kind": item["key"]} for item in types]
    rows.append({"exam_kind": ""})
    columns = exam_columns(rows, types)
    assert [key for key, _label in columns] == ["first", "second", "third", "fourth", "fifth"]
    assert exam_columns([{"exam_kind": ""}, {"exam_kind": "first"}], types) == [
        ("first", "First"),
        ("", "Exam"),
    ]
