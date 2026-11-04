from app.reporting import _exam_rows, _part_heading_for_rows, describe_part, describe_parts, exam_columns


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
        "Costing",
    )
    assert describe_parts(
        "acct", "part", "", {"kind": "part", "item_ids": ["mod-1", "mod-2"]}, papers, units, {"part": "Part"},
    ) == [
        ("acct|part|mod-1", "Costing"),
        ("acct|part|mod-2", "Ledgers"),
    ]


def test_exam_columns_follow_weight_for_every_type_on_the_results():
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
    assert [key for key, _label in columns] == ["first", "second", "third", "fourth", "fifth", "late", ""]
    assert columns[-1] == ("", "Exam")
    assert exam_columns([{"exam_kind": ""}, {"exam_kind": "first"}], types) == [
        ("first", "First"),
        ("", "Exam"),
    ]
    assert exam_columns([{"exam_kind": "late"}], types) == [("late", "Late")]


def test_exam_rows_stack_combined_sub_parts_on_one_result_row():
    rows = [
        {
            "id": "result-1",
            "subject_id": "acct",
            "status": "scored",
            "score": 40,
            "maximum": 50,
            "part_items": [
                {"key": "acct|part|mod-1", "label": "Costing"},
                {"key": "acct|part|mod-2", "label": "Ledgers"},
            ],
        }
    ]
    table = _exam_rows(rows, {"subject": {"acct": "Accountancy"}}, {"bands": {"danger_below": 40, "safe_above": 60}})
    assert len(table) == 1
    assert table[0][0] == "Accountancy"
    assert table[0][1] == "Costing\nLedgers"
    assert table[0][2] == "40 of 50"
    assert table[0][3] == "80.00%"
    assert table[0][5] == "-"
    assert table[0][6] == "-"
    assert table[0][7] == "-"


def test_part_heading_uses_the_sub_part_type_for_the_exam_type():
    rows = [
        {"part_kind": "module", "part_kind_label": "Module"},
        {"part_kind": "module", "part_kind_label": "Module"},
    ]
    assert _part_heading_for_rows(rows, "Part") == "Module"
    assert _part_heading_for_rows([{"part_kind": "subject", "part_kind_label": ""}], "Part") == "Part"
    assert _part_heading_for_rows(
        [{"part_kind": "module", "part_kind_label": "Module"}, {"part_kind": "chapter", "part_kind_label": "Chapter"}],
        "Unit",
    ) == "Unit"
