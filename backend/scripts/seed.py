#!/usr/bin/env python
"""
Generate the Saffron House sample dataset and load it into MySQL + TimescaleDB.

The generator is deterministic (seed 20261025) and produces:
  * 120 days of restaurant operations
  * realistic lunch/dinner demand, chef assignments, split payments and discounts
  * a denormalized order_event stream for TimescaleDB
  * CSV snapshots in data/sample (for inspection / report appendix)

Run from the project root:
    .venv/Scripts/python.exe backend/scripts/seed.py
"""
from __future__ import annotations

import csv
import json
import random
import sys
import time
from datetime import date, datetime, time as dtime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

import mysql.connector
import psycopg

from restaurant.config import Config
from restaurant.timeutil import LOCAL_TZ, now_local

SEED = 20261025
HISTORY_DAYS = 120
SAMPLE_DIR = ROOT / "data" / "sample"
GENERATED_DIR = ROOT / "data" / "generated"
EVENT_CSV = GENERATED_DIR / "order_events.csv"

rng = random.Random(SEED)
MONEY = Decimal("0.01")
TAX_RATE = Decimal("0.05")

# ---------------------------------------------------------------------------
# Master data
# ---------------------------------------------------------------------------
CATEGORIES = [
    (1, "Small Plates"),
    (2, "Tandoor & Kebabs"),
    (3, "North Indian Mains"),
    (4, "South Indian"),
    (5, "Continental"),
    (6, "Breads & Rice"),
    (7, "Desserts"),
    (8, "Beverages"),
]

# (id, category_id, name, description, price, is_veg, is_available, cuisine, popularity)
MENU_ITEMS = [
    (1, 1, "Paneer Tikka", "Charred cottage cheese, ajwain marinade, mint chutney", 320, True, True, "Tandoor", 10),
    (2, 1, "Hara Bhara Kebab", "Spinach, green peas and cashew patties", 280, True, True, "Tandoor", 7),
    (3, 1, "Chilli Paneer", "Wok-tossed paneer, peppers and spring onion", 300, True, True, "Chinese", 8),
    (4, 1, "Chicken 65", "Curry leaf, yoghurt and red chilli fried chicken", 360, False, True, "South Indian", 8),
    (5, 1, "Tandoori Mushroom", "Button mushrooms, smoky yogurt marinade", 310, True, True, "Tandoor", 5),
    (6, 1, "Crispy Corn", "Sweet corn, curry leaf and chilli salt", 240, True, True, "Chinese", 6),
    (7, 2, "Murgh Malai Tikka", "Creamy cardamom chicken skewers", 420, False, True, "Tandoor", 9),
    (8, 2, "Seekh Kebab", "Minced lamb, green chilli and fresh herbs", 390, False, True, "Tandoor", 8),
    (9, 2, "Tandoori Chicken (Half)", "Overnight chili-yogurt marinade, clay oven", 460, False, True, "Tandoor", 9),
    (10, 2, "Paneer Malai Tikka", "Paneer, cream, cardamom and white pepper", 360, True, True, "Tandoor", 7),
    (11, 2, "Lahori Fish Tikka", "Ajwain-spiced river fish, charred lemon", 480, False, True, "Tandoor", 6),
    (12, 2, "Soya Chaap", "Malai-marinated soya chaap, smoked butter", 320, True, False, "Tandoor", 4),
    (13, 3, "Butter Chicken", "Velvety tomato gravy, fenugreek and white butter", 480, False, True, "North Indian", 10),
    (14, 3, "Dal Makhani", "Black lentils simmered overnight", 320, True, True, "North Indian", 9),
    (15, 3, "Paneer Butter Masala", "Cottage cheese in a silky tomato-cashew gravy", 380, True, True, "North Indian", 9),
    (16, 3, "Rogan Josh", "Kashmiri lamb, ratanjot and fennel", 520, False, True, "North Indian", 6),
    (17, 3, "Kadai Chicken", "Peppers, onions and freshly pounded spices", 440, False, True, "North Indian", 7),
    (18, 3, "Malai Kofta", "Paneer dumplings in saffron cream", 360, True, True, "North Indian", 6),
    (19, 4, "Masala Dosa", "Crisp dosa, spiced potato, coconut chutney", 240, True, True, "South Indian", 8),
    (20, 4, "Hyderabadi Chicken Biryani", "Dum-cooked basmati, saffron and mirchi ka salan", 420, False, True, "South Indian", 10),
    (21, 4, "Chettinad Chicken", "Peppercorn, fennel and coconut masala", 460, False, True, "South Indian", 6),
    (22, 4, "Lemon Rice", "Turmeric rice, peanuts and curry leaf", 210, True, True, "South Indian", 4),
    (23, 4, "Rasam & Rice", "Tamarind pepper broth with steamed rice", 200, True, True, "South Indian", 4),
    (24, 4, "Ghee Podi Idli", "Mini idlis tossed in gunpowder and ghee", 220, True, True, "South Indian", 6),
    (25, 5, "Grilled Chicken Steak", "Herb butter, mash and seasonal greens", 520, False, True, "Continental", 6),
    (26, 5, "Alfredo Pasta", "Fettuccine, parmesan, cracked pepper", 390, True, True, "Continental", 7),
    (27, 5, "Mushroom Risotto", "Arborio, porcini, truffle oil", 420, True, True, "Continental", 5),
    (28, 5, "Garden Caesar Salad", "Cos lettuce, sourdough croutons, green goddess", 320, True, True, "Continental", 4),
    (29, 5, "Herb Roast Potatoes", "Rosemary, sea salt and garlic aioli", 240, True, True, "Continental", 5),
    (30, 5, "Peri Peri Chicken", "Flame-grilled chicken, peri peri butter", 480, False, True, "Continental", 7),
    (31, 6, "Butter Naan", "Clay oven naan, cultured butter", 70, True, True, "Tandoor", 10),
    (32, 6, "Garlic Naan", "Garlic, coriander and ghee", 90, True, True, "Tandoor", 9),
    (33, 6, "Tandoori Roti", "Whole wheat, charcoal blistered", 50, True, False, "Tandoor", 5),
    (34, 6, "Jeera Rice", "Basmati, cumin and ghee", 180, True, True, "North Indian", 6),
    (35, 6, "Steamed Rice", "Fluffy basmati", 140, True, True, "North Indian", 5),
    (36, 6, "Laccha Paratha", "Flaky whole-wheat paratha", 90, True, True, "Tandoor", 7),
    (37, 7, "Gulab Jamun", "Warm milk dumplings, saffron syrup", 180, True, True, "Desserts", 7),
    (38, 7, "Rasmalai", "Cottage cheese discs, cardamom milk", 200, True, True, "Desserts", 6),
    (39, 7, "Chocolate Fondant", "Molten 55% chocolate, vanilla bean ice cream", 280, True, True, "Desserts", 8),
    (40, 7, "New York Cheesecake", "Baked cheesecake, berry compote", 300, True, False, "Desserts", 6),
    (41, 7, "Kulfi Falooda", "Pistachio kulfi, rose and vermicelli", 240, True, True, "Desserts", 5),
    (42, 7, "Tiramisu", "Espresso, mascarpone and cocoa", 320, True, True, "Desserts", 6),
    (43, 8, "Masala Chai", "Assam tea, ginger and cardamom", 90, True, True, "Beverages", 7),
    (44, 8, "Filter Coffee", "South Indian filter decoction", 100, True, True, "Beverages", 7),
    (45, 8, "Mango Lassi", "Alphonso yoghurt shake", 160, True, True, "Beverages", 7),
    (46, 8, "Fresh Lime Soda", "Sweet, salted or mixed", 120, True, True, "Beverages", 6),
    (47, 8, "Cold Coffee", "Creamy cold brew, cocoa dust", 180, True, True, "Beverages", 6),
    (48, 8, "Virgin Mojito", "Lime, mint and soda", 170, True, True, "Beverages", 6),
]

WAITERS = [
    (1, "Aarav Nair", "+91 98450 12001", "Terrace"),
    (2, "Meera Iyer", "+91 98450 12002", "Main Hall"),
    (3, "Rohan Gupta", "+91 98450 12003", "Garden"),
    (4, "Ananya Rao", "+91 98450 12004", "Main Hall"),
    (5, "Kabir Menon", "+91 98450 12005", "Private Dining"),
    (6, "Ishita Sharma", "+91 98450 12006", "Terrace"),
    (7, "Dev Patel", "+91 98450 12007", "Garden"),
    (8, "Sana Khan", "+91 98450 12008", "Main Hall"),
    (9, "Arjun Reddy", "+91 98450 12009", "Terrace"),
    (10, "Priya Verma", "+91 98450 12010", "Private Dining"),
    (11, "Nikhil Joshi", "+91 98450 12011", "Garden"),
    (12, "Tanya Bose", "+91 98450 12012", "Main Hall"),
    (13, "Rahul Pillai", "+91 98450 12013", "Terrace"),
    (14, "Sneha Kapoor", "+91 98450 12014", "Garden"),
    (15, "Aditya Kulkarni", "+91 98450 12015", "Main Hall"),
    (16, "Zoya Sheikh", "+91 98450 12016", "Private Dining"),
    (17, "Karan Malhotra", "+91 98450 12017", "Terrace"),
    (18, "Divya Shenoy", "+91 98450 12018", "Main Hall"),
    (19, "Vivek Chawla", "+91 98450 12019", "Garden"),
    (20, "Nandini Das", "+91 98450 12020", "Private Dining"),
    (21, "Manav Bhatia", "+91 98450 12021", "Terrace"),
    (22, "Riya Thomas", "+91 98450 12022", "Main Hall"),
]

CHEFS = [
    (23, "Sanjay Kapoor", "+91 98450 13001", "Tandoor"),
    (24, "Imran Qureshi", "+91 98450 13002", "Tandoor"),
    (25, "Suresh Yadav", "+91 98450 13003", "North Indian"),
    (26, "Pooja Agarwal", "+91 98450 13004", "North Indian"),
    (27, "Vikram Singh", "+91 98450 13005", "North Indian"),
    (28, "Lakshmi Krishnan", "+91 98450 13006", "South Indian"),
    (29, "Ramesh Iyengar", "+91 98450 13007", "South Indian"),
    (30, "Neha Deshpande", "+91 98450 13008", "Continental"),
    (31, "Alex Fernandes", "+91 98450 13009", "Continental"),
    (32, "Wei Chen", "+91 98450 13010", "Chinese"),
    (33, "Maya Lin", "+91 98450 13011", "Chinese"),
    (34, "Fatima Baig", "+91 98450 13012", "Desserts"),
    (35, "Deepa Menon", "+91 98450 13013", "Desserts"),
    (36, "Arun Kumar", "+91 98450 13014", "Beverages"),
    (37, "Farah Ansari", "+91 98450 13015", "Beverages"),
]

CASHIERS = [
    (38, "Kavya Ramesh", "+91 98450 14001", 1),
    (39, "Sameer Ali", "+91 98450 14002", 2),
    (40, "Preeti Sharma", "+91 98450 14003", 3),
    (41, "Joel D'Souza", "+91 98450 14004", 4),
    (42, "Ayesha Siddiqui", "+91 98450 14005", 5),
    (43, "Harish Patel", "+91 98450 14006", 6),
]

CHEF_POOL = {
    "Tandoor": [23, 24],
    "North Indian": [25, 26, 27],
    "South Indian": [28, 29],
    "Continental": [30, 31],
    "Chinese": [32, 33],
    "Desserts": [34, 35],
    "Beverages": [36, 37],
}
STAFF_NAMES = {sid: name for sid, name, _, _ in WAITERS + CHEFS}
STAFF_NAMES.update({sid: name for sid, name, _, _ in CASHIERS})
CHEF_NAMES = {sid: name for sid, name, _, _ in CHEFS}
CATEGORY_NAMES = {cid: name for cid, name in CATEGORIES}

TABLES = (
    [(i, 2) for i in range(1, 9)]
    + [(i, 4) for i in range(9, 23)]
    + [(i, 6) for i in range(23, 30)]
    + [(i, 8) for i in range(30, 33)]
)

FIRST_NAMES = [
    "Aarav", "Vihaan", "Aditi", "Saanvi", "Reyansh", "Ira", "Kiaan", "Myra",
    "Aryan", "Anika", "Dhruv", "Kiara", "Vivaan", "Aadhya", "Arjun", "Aarohi",
    "Rudra", "Diya", "Krishna", "Avani", "Ishaan", "Anaya", "Shaurya", "Pari",
    "Yash", "Riya", "Neel", "Mira", "Kabir", "Tara", "Dev", "Leela",
    "Ayaan", "Naina", "Om", "Sara", "Veer", "Mahi", "Jai", "Zoya",
]

LAST_NAMES = [
    "Sharma", "Iyer", "Gupta", "Nair", "Reddy", "Menon", "Patel", "Rao",
    "Desai", "Kulkarni", "Bose", "Chatterjee", "Singh", "Kapoor", "Mehta",
    "Joshi", "Verma", "Pillai", "Khan", "Shenoy", "Bhat", "Chawla", "Thomas",
    "Malhotra", "Agarwal", "Das", "Fernandes", "D'Souza", "Baig", "Ansari",
]

NOTES = [
    None, None, None, None, None,
    "Window seat preferred",
    "Birthday celebration — dessert candle",
    "No onion, no garlic",
    "Mild spice please",
    "Table needs a high chair",
    "Allergy: peanuts",
    "Takeaway packed separately",
]


def money(value) -> Decimal:
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)


def iso_ts(dt: datetime) -> str:
    return dt.astimezone(LOCAL_TZ).isoformat(timespec="seconds")


def fmt_money(value) -> str:
    return "" if value is None else f"{Decimal(value):.2f}"


def build_customers(n=420):
    customers = []
    for idx in range(1, n + 1):
        name = f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}"
        phone = f"+91 99{idx:03d} {rng.randint(10000, 99999)}"
        email = f"guest{idx:03d}@saffron.example"
        created = now_local() - timedelta(days=rng.randint(10, 900), hours=rng.randint(0, 23))
        customers.append((idx, name, email, phone, created.replace(tzinfo=None)))
    return customers


class DatasetBuilder:
    def __init__(self, now: datetime, event_file):
        self.now = now
        self.rng = random.Random(SEED + 7)
        self.event_file = event_file
        self.event_writer = csv.writer(event_file)
        self.event_writer.writerow([
            "event_time", "event_type", "order_id", "order_type", "table_id",
            "customer_id", "waiter_id", "waiter_name", "chef_id", "chef_name",
            "item_id", "item_name", "category_name", "quantity", "amount",
            "payment_mode", "bill_id", "payment_id", "prep_seconds",
        ])
        self.event_sample = []
        self.event_counts = {}
        self.event_total = 0

        self.orders = []
        self.order_items = []
        self.bills = []
        self.payments = []
        self.next_order_id = 1
        self.next_bill_id = 1
        self.next_payment_id = 1

        self.available_items = [item for item in MENU_ITEMS if item[6]]
        self.item_weights = [item[8] for item in self.available_items]
        self.item_by_id = {item[0]: item for item in MENU_ITEMS}
        self.customer_weights = [self.rng.random() * 4 + 1 for _ in range(420)]
        self.waiter_ids = [w[0] for w in WAITERS]
        self.cashier_ids = [c[0] for c in CASHIERS]

    # -- event helpers ------------------------------------------------------
    def emit(self, when, event_type, order_id, order_type, table_id, customer_id,
             waiter_id, waiter_name, *, chef_id=None, chef_name=None, item_id=None,
             item_name=None, category_name=None, quantity=None, amount=None,
             payment_mode=None, bill_id=None, payment_id=None, prep_seconds=None):
        row = [
            iso_ts(when), event_type, order_id, order_type, table_id, customer_id,
            waiter_id, waiter_name,
            chef_id if chef_id is not None else "",
            chef_name or "",
            item_id if item_id is not None else "",
            item_name or "",
            category_name or "",
            quantity if quantity is not None else "",
            fmt_money(amount),
            payment_mode or "",
            bill_id if bill_id is not None else "",
            payment_id if payment_id is not None else "",
            prep_seconds if prep_seconds is not None else "",
        ]
        self.event_writer.writerow(row)
        if len(self.event_sample) < 160:
            self.event_sample.append(row)
        self.event_total += 1
        self.event_counts[event_type] = self.event_counts.get(event_type, 0) + 1

    def choose_customer(self):
        if self.rng.random() < 0.62:
            return self.rng.choices(range(1, 421), weights=self.customer_weights, k=1)[0]
        return None

    def choose_items(self, n_items):
        pool = list(self.available_items)
        weights = list(self.item_weights)
        chosen = []
        for _ in range(min(n_items, len(pool))):
            pick = self.rng.choices(range(len(pool)), weights=weights, k=1)[0]
            chosen.append(pool.pop(pick))
            weights.pop(pick)
        return chosen

    def order_items_for(self, chosen):
        lines = []
        for item in chosen:
            qty = self.rng.choices([1, 2, 3], weights=[0.78, 0.18, 0.04], k=1)[0]
            chef_id = self.rng.choice(CHEF_POOL[item[7]])
            line_total = money(Decimal(item[4]) * qty)
            lines.append({
                "item": item,
                "quantity": qty,
                "chef_id": chef_id,
                "line_total": line_total,
            })
        return lines

    def add_events_for_order(self, ctx, lines, *, placed_at, prepared_at=None,
                             bill=None, payments=(), closed_at=None,
                             cancelled_at=None, active_stage=None):
        self.emit(placed_at, "ORDER_PLACED", ctx["order_id"], ctx["order_type"],
                  ctx["table_id"], ctx["customer_id"], ctx["waiter_id"],
                  ctx["waiter_name"], quantity=ctx["party_size"])

        for idx, line in enumerate(lines):
            item = line["item"]
            self.emit(
                placed_at + timedelta(seconds=25 + idx * 20),
                "ITEM_ADDED",
                ctx["order_id"], ctx["order_type"], ctx["table_id"],
                ctx["customer_id"], ctx["waiter_id"], ctx["waiter_name"],
                chef_id=line["chef_id"], chef_name=CHEF_NAMES[line["chef_id"]],
                item_id=item[0], item_name=item[2],
                category_name=CATEGORY_NAMES[item[1]],
                quantity=line["quantity"], amount=line["line_total"],
            )

        if cancelled_at is not None:
            self.emit(cancelled_at, "ORDER_CANCELLED", ctx["order_id"], ctx["order_type"],
                      ctx["table_id"], ctx["customer_id"], ctx["waiter_id"],
                      ctx["waiter_name"])
            return

        if active_stage == "PLACED":
            return

        self.emit(placed_at + timedelta(minutes=self.rng.randint(3, 6)),
                  "ORDER_PREPARING", ctx["order_id"], ctx["order_type"],
                  ctx["table_id"], ctx["customer_id"], ctx["waiter_id"],
                  ctx["waiter_name"])

        if active_stage == "PREPARING":
            return

        if prepared_at is not None:
            prep_seconds = int((prepared_at - placed_at).total_seconds())
            self.emit(prepared_at, "ORDER_PREPARED", ctx["order_id"], ctx["order_type"],
                      ctx["table_id"], ctx["customer_id"], ctx["waiter_id"],
                      ctx["waiter_name"], prep_seconds=prep_seconds)

        if bill is None:
            return

        self.emit(bill["generated_at"], "BILL_GENERATED", ctx["order_id"],
                  ctx["order_type"], ctx["table_id"], ctx["customer_id"],
                  ctx["waiter_id"], ctx["waiter_name"],
                  amount=bill["grand_total"], quantity=len(lines),
                  bill_id=bill["bill_id"])

        for payment in payments:
            self.emit(payment["payment_date"], "PAYMENT_RECEIVED", ctx["order_id"],
                      ctx["order_type"], ctx["table_id"], ctx["customer_id"],
                      ctx["waiter_id"], ctx["waiter_name"],
                      amount=payment["amount"], payment_mode=payment["payment_mode"],
                      bill_id=bill["bill_id"], payment_id=payment["payment_id"])

        if closed_at is not None:
            self.emit(closed_at, "ORDER_CLOSED", ctx["order_id"], ctx["order_type"],
                      ctx["table_id"], ctx["customer_id"], ctx["waiter_id"],
                      ctx["waiter_name"], quantity=ctx["party_size"])

    def add_closed_order(self, placed_at: datetime):
        order_id = self.next_order_id
        self.next_order_id += 1

        order_type = self.rng.choices(
            ["DINE_IN", "TAKEAWAY", "DELIVERY"], weights=[0.82, 0.11, 0.07], k=1
        )[0]
        party_size = self.rng.choices([2, 3, 4, 5, 6], weights=[0.34, 0.16, 0.3, 0.12, 0.08], k=1)[0]
        if order_type == "DINE_IN":
            candidates = [t for t in TABLES if t[1] >= party_size]
            if not candidates:
                candidates = [max(TABLES, key=lambda t: t[1])]
            table = self.rng.choice(candidates)
            table_id = table[0]
            party_size = min(party_size, table[1])
        else:
            table_id = None
            party_size = self.rng.randint(1, 4)

        customer_id = self.choose_customer()
        waiter_id = self.rng.choice(self.waiter_ids)
        waiter_name = STAFF_NAMES[waiter_id]

        n_items = self.rng.choices([1, 2, 3, 4, 5, 6], weights=[0.08, 0.18, 0.3, 0.24, 0.13, 0.07], k=1)[0]
        lines = self.order_items_for(self.choose_items(n_items))
        subtotal = money(sum((line["line_total"] for line in lines), Decimal("0")))
        prep_minutes = 7 + n_items * 2 + self.rng.randint(0, 12)
        prepared_at = placed_at + timedelta(minutes=prep_minutes)

        ctx = {
            "order_id": order_id,
            "order_type": order_type,
            "table_id": table_id,
            "customer_id": customer_id,
            "waiter_id": waiter_id,
            "waiter_name": waiter_name,
            "party_size": party_size,
        }

        if self.rng.random() < 0.012:
            cancelled_at = placed_at + timedelta(minutes=self.rng.randint(2, 12))
            self.orders.append((
                order_id, customer_id, table_id, waiter_id, None, order_type,
                "CANCELLED", placed_at.replace(tzinfo=None), None,
                cancelled_at.replace(tzinfo=None), self.rng.choice(NOTES),
            ))
            for line_no, line in enumerate(lines, start=1):
                item = line["item"]
                self.order_items.append((
                    order_id, line_no, item[0], line["chef_id"], line["quantity"],
                    money(item[4]), None,
                ))
            self.add_events_for_order(ctx, lines, placed_at=placed_at, cancelled_at=cancelled_at)
            return

        bill_at = prepared_at + timedelta(minutes=self.rng.randint(2, 10))
        dining_minutes = self.rng.randint(20, 75) if order_type == "DINE_IN" else self.rng.randint(3, 15)
        first_payment_at = bill_at + timedelta(minutes=dining_minutes)

        discount_pct = self.rng.choices([0, 5, 10, 15], weights=[0.9, 0.04, 0.04, 0.02], k=1)[0]
        tax = money(subtotal * TAX_RATE)
        discount = money(subtotal * Decimal(discount_pct) / Decimal(100))
        grand_total = money(subtotal + tax - discount)

        bill_id = self.next_bill_id
        self.next_bill_id += 1
        payment_count = self.rng.choices([1, 2, 3], weights=[0.84, 0.12, 0.04], k=1)[0]
        payment_amounts = self.split_amount(grand_total, payment_count)
        modes = [
            self.rng.choices(["UPI", "CARD", "CASH", "ONLINE"],
                             weights=[0.44, 0.31, 0.2, 0.05], k=1)[0]
            for _ in range(payment_count)
        ]
        payments = []
        current = first_payment_at
        for amount, mode in zip(payment_amounts, modes):
            payments.append({
                "payment_id": self.next_payment_id,
                "amount": amount,
                "payment_mode": mode,
                "payment_date": current,
            })
            self.next_payment_id += 1
            current += timedelta(minutes=self.rng.randint(1, 3))
        closed_at = payments[-1]["payment_date"] + timedelta(minutes=self.rng.randint(1, 3))
        cashier_id = self.rng.choice(self.cashier_ids)

        bill = {
            "bill_id": bill_id,
            "subtotal": subtotal,
            "tax": tax,
            "discount": discount,
            "grand_total": grand_total,
            "generated_at": bill_at,
        }

        self.orders.append((
            order_id, customer_id, table_id, waiter_id, cashier_id, order_type,
            "CLOSED", placed_at.replace(tzinfo=None), prepared_at.replace(tzinfo=None),
            closed_at.replace(tzinfo=None), self.rng.choice(NOTES),
        ))

        for line_no, line in enumerate(lines, start=1):
            item = line["item"]
            self.order_items.append((
                order_id, line_no, item[0], line["chef_id"], line["quantity"],
                money(item[4]), bill_id,
            ))

        self.bills.append((
            bill_id, order_id, subtotal, tax, discount, grand_total,
            "UNPAID", bill_at.replace(tzinfo=None),
        ))
        for payment in payments:
            self.payments.append((
                payment["payment_id"], bill_id, payment["amount"],
                payment["payment_mode"], payment["payment_date"].replace(tzinfo=None),
                "SUCCESS",
            ))

        self.add_events_for_order(
            ctx, lines, placed_at=placed_at, prepared_at=prepared_at,
            bill=bill, payments=payments, closed_at=closed_at,
        )

    def split_amount(self, total: Decimal, n: int):
        if n == 1:
            return [total]
        if n == 2:
            first = money(total * Decimal(str(self.rng.uniform(0.3, 0.7))))
            return [first, money(total - first)]
        a = money(total * Decimal(str(self.rng.uniform(0.2, 0.4))))
        b = money(total * Decimal(str(self.rng.uniform(0.25, 0.45))))
        c = money(total - a - b)
        if c <= 0:
            return [money(total / 2), money(total - money(total / 2))]
        return [a, b, c]

    def add_active_order(self, stage, table_id, minutes_ago):
        order_id = self.next_order_id
        self.next_order_id += 1
        placed_at = self.now - timedelta(minutes=minutes_ago)
        capacity = dict(TABLES)[table_id]
        table_capacity = capacity
        party_size = min(table_capacity, self.rng.choice([2, 3, 4, 5, 6]))
        customer_id = self.choose_customer()
        waiter_id = self.rng.choice(self.waiter_ids)
        waiter_name = STAFF_NAMES[waiter_id]

        n_items = self.rng.choices([2, 3, 4, 5], weights=[0.25, 0.35, 0.25, 0.15], k=1)[0]
        lines = self.order_items_for(self.choose_items(n_items))
        subtotal = money(sum((line["line_total"] for line in lines), Decimal("0")))
        prep_minutes = self.rng.randint(12, 28)
        prepared_at = placed_at + timedelta(minutes=prep_minutes)
        if stage in ("PREPARED", "BILLED"):
            last_event = self.now - timedelta(minutes=8)
            if prepared_at > last_event:
                prepared_at = last_event
        else:
            prepared_at = None

        ctx = {
            "order_id": order_id,
            "order_type": "DINE_IN",
            "table_id": table_id,
            "customer_id": customer_id,
            "waiter_id": waiter_id,
            "waiter_name": waiter_name,
            "party_size": party_size,
        }

        bill = None
        payments = []
        cashier_id = None
        closed_at = None
        bill_id = None

        if stage == "BILLED":
            cashier_id = self.rng.choice(self.cashier_ids)
            discount_pct = self.rng.choices([0, 5, 10], weights=[0.85, 0.1, 0.05], k=1)[0]
            tax = money(subtotal * TAX_RATE)
            discount = money(subtotal * Decimal(discount_pct) / Decimal(100))
            grand_total = money(subtotal + tax - discount)
            bill_id = self.next_bill_id
            self.next_bill_id += 1
            bill_at = self.now - timedelta(minutes=self.rng.randint(15, 30))
            if prepared_at and bill_at <= prepared_at:
                bill_at = prepared_at + timedelta(minutes=2)
            payment_at = self.now - timedelta(minutes=self.rng.randint(2, 6))
            if payment_at <= bill_at:
                payment_at = bill_at + timedelta(minutes=1)
            mode = self.rng.choices(["UPI", "CARD", "CASH", "ONLINE"],
                                    weights=[0.44, 0.31, 0.2, 0.05], k=1)[0]
            partial = money(grand_total * Decimal(str(self.rng.uniform(0.35, 0.58))))
            payment_id = self.next_payment_id
            self.next_payment_id += 1
            bill = {
                "bill_id": bill_id,
                "subtotal": subtotal,
                "tax": tax,
                "discount": discount,
                "grand_total": grand_total,
                "generated_at": bill_at,
            }
            payments = [{
                "payment_id": payment_id,
                "amount": partial,
                "payment_mode": mode,
                "payment_date": payment_at,
            }]
            self.bills.append((
                bill_id, order_id, subtotal, tax, discount, grand_total,
                "UNPAID", bill_at.replace(tzinfo=None),
            ))
            self.payments.append((
                payment_id, bill_id, partial, mode, payment_at.replace(tzinfo=None), "SUCCESS",
            ))

        self.orders.append((
            order_id, customer_id, table_id, waiter_id, cashier_id, "DINE_IN",
            stage, placed_at.replace(tzinfo=None),
            prepared_at.replace(tzinfo=None) if prepared_at else None,
            closed_at, self.rng.choice(NOTES),
        ))

        for line_no, line in enumerate(lines, start=1):
            item = line["item"]
            self.order_items.append((
                order_id, line_no, item[0], line["chef_id"], line["quantity"],
                money(item[4]), bill_id,
            ))

        self.add_events_for_order(
            ctx, lines, placed_at=placed_at,
            prepared_at=prepared_at,
            bill=bill, payments=payments, closed_at=closed_at,
            active_stage=stage,
        )

    def add_active_orders(self):
        templates = [
            ("PLACED", 3, 12), ("PLACED", 7, 25),
            ("PREPARING", 12, 32), ("PREPARING", 18, 45),
            ("PREPARED", 24, 58), ("PREPARED", 29, 66),
            ("BILLED", 5, 85), ("BILLED", 14, 95), ("BILLED", 27, 110),
        ]
        for stage, table_id, minutes_ago in templates:
            self.add_active_order(stage, table_id, minutes_ago)

    def build_history(self):
        today = self.now.date()
        for offset in range(HISTORY_DAYS - 1, 0, -1):
            day = today - timedelta(days=offset)
            weekday = day.weekday()
            multiplier = 1.32 if weekday >= 5 else (1.12 if weekday == 4 else 1.0)
            volume = int(self.rng.randint(205, 245) * multiplier)
            times = sorted(self.service_time(day) for _ in range(volume))
            for placed_at in times:
                self.add_closed_order(placed_at)

        # Today: generate completed lunch/afternoon trade, then live tables.
        open_dt = datetime.combine(today, dtime(11, 0)).replace(tzinfo=LOCAL_TZ)
        end_dt = self.now - timedelta(hours=3)
        if end_dt <= open_dt:
            open_dt = self.now - timedelta(hours=5)
            end_dt = self.now - timedelta(hours=2)
        span_seconds = max(int((end_dt - open_dt).total_seconds()), 3600)
        today_count = 62
        # Fixed-width draw keeps the RNG stream independent of the wall-clock span,
        # so reseeding at a different time reproduces the same dataset.
        today_times = sorted(
            open_dt + timedelta(seconds=int(self.rng.random() * span_seconds))
            for _ in range(today_count)
        )
        for placed_at in today_times:
            self.add_closed_order(placed_at)

        self.add_active_orders()

    def service_time(self, day):
        hours = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]
        weights = [3, 10, 12, 8, 4, 2, 3, 6, 12, 14, 12, 6, 2]
        hour = self.rng.choices(hours, weights=weights, k=1)[0]
        minute = self.rng.randint(0, 59)
        return datetime.combine(day, dtime(hour, minute)).replace(tzinfo=LOCAL_TZ)


# ---------------------------------------------------------------------------
# Export helpers
# ---------------------------------------------------------------------------
def write_csv(path: Path, headers, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(rows)


def export_samples(builder: DatasetBuilder, customers, event_sample):
    staff_rows = []
    for sid, name, contact, section in WAITERS:
        staff_rows.append((sid, name, contact, "WAITER", section, ""))
    for sid, name, contact, cuisine in CHEFS:
        staff_rows.append((sid, name, contact, "CHEF", "", cuisine))
    for sid, name, contact, counter in CASHIERS:
        staff_rows.append((sid, name, contact, "CASHIER", "", ""))
    write_csv(SAMPLE_DIR / "staff.csv",
              ["staff_id", "name", "contact", "role", "table_section", "cuisine_type"],
              staff_rows)
    write_csv(SAMPLE_DIR / "menu_categories.csv", ["category_id", "category_name"], CATEGORIES)
    write_csv(
        SAMPLE_DIR / "menu_items.csv",
        ["item_id", "category_id", "name", "description", "price", "is_available", "is_veg", "cuisine", "popularity"],
        MENU_ITEMS,
    )
    write_csv(SAMPLE_DIR / "dining_tables.csv", ["table_id", "capacity"], TABLES)
    write_csv(SAMPLE_DIR / "customers_sample.csv",
              ["customer_id", "name", "email", "phone", "created_at"], customers[:60])
    write_csv(SAMPLE_DIR / "orders_sample.csv",
              ["order_id", "customer_id", "table_id", "waiter_id", "cashier_id",
               "order_type", "status", "placed_at", "prepared_at", "closed_at", "notes"],
              builder.orders[:120])
    first_orders = {row[0] for row in builder.orders[:120]}
    write_csv(SAMPLE_DIR / "order_items_sample.csv",
              ["order_id", "line_no", "item_id", "chef_id", "quantity", "price_at_order", "bill_id"],
              [row for row in builder.order_items if row[0] in first_orders])
    write_csv(SAMPLE_DIR / "bills_sample.csv",
              ["bill_id", "order_id", "subtotal", "tax", "discount_amount", "grand_total", "payment_status", "generated_at"],
              builder.bills[:60])
    write_csv(SAMPLE_DIR / "payments_sample.csv",
              ["payment_id", "bill_id", "amount", "payment_mode", "payment_date", "payment_status"],
              builder.payments[:80])
    write_csv(SAMPLE_DIR / "order_events_sample.csv",
              ["event_time", "event_type", "order_id", "order_type", "table_id",
               "customer_id", "waiter_id", "waiter_name", "chef_id", "chef_name",
               "item_id", "item_name", "category_name", "quantity", "amount",
               "payment_mode", "bill_id", "payment_id", "prep_seconds"],
              event_sample)


# ---------------------------------------------------------------------------
# Database loaders
# ---------------------------------------------------------------------------
def mysql_connect():
    return mysql.connector.connect(**Config.mysql_config())


def insert_batches(conn, sql, rows, batch_size=2500):
    if not rows:
        return
    cur = conn.cursor()
    try:
        for start in range(0, len(rows), batch_size):
            cur.executemany(sql, rows[start:start + batch_size])
            conn.commit()
    finally:
        cur.close()


def reset_mysql(conn):
    cur = conn.cursor()
    try:
        cur.execute("SET FOREIGN_KEY_CHECKS = 0")
        for table in [
            "payment", "order_item", "bill", "orders", "analytics_outbox",
            "menu_item", "menu_category", "dining_table", "customer",
            "cashier", "chef", "waiter", "staff",
        ]:
            cur.execute(f"TRUNCATE TABLE {table}")
        cur.execute("SET FOREIGN_KEY_CHECKS = 1")
        conn.commit()
    finally:
        cur.close()


def load_mysql(builder: DatasetBuilder, customers):
    conn = mysql_connect()
    try:
        reset_mysql(conn)
        staff = [(sid, name, contact, "WAITER", True) for sid, name, contact, _ in WAITERS]
        staff += [(sid, name, contact, "CHEF", True) for sid, name, contact, _ in CHEFS]
        staff += [(sid, name, contact, "CASHIER", True) for sid, name, contact, _ in CASHIERS]
        insert_batches(
            conn,
            "INSERT INTO staff (staff_id, name, contact, role, is_active) VALUES (%s,%s,%s,%s,%s)",
            staff,
        )
        insert_batches(conn,
                       "INSERT INTO waiter (staff_id, table_section) VALUES (%s,%s)",
                       [(sid, section) for sid, _, _, section in WAITERS])
        insert_batches(conn,
                       "INSERT INTO chef (staff_id, cuisine_type) VALUES (%s,%s)",
                       [(sid, cuisine) for sid, _, _, cuisine in CHEFS])
        insert_batches(conn,
                       "INSERT INTO cashier (staff_id, counter_no) VALUES (%s,%s)",
                       [(sid, counter) for sid, _, _, counter in CASHIERS])
        insert_batches(conn,
                       "INSERT INTO customer (customer_id, name, email, phone, created_at) VALUES (%s,%s,%s,%s,%s)",
                       customers)
        insert_batches(conn,
                       "INSERT INTO dining_table (table_id, capacity, status) VALUES (%s,%s,'FREE')",
                       TABLES)
        insert_batches(conn,
                       "INSERT INTO menu_category (category_id, category_name) VALUES (%s,%s)",
                       CATEGORIES)
        menu_rows = [
            (i, cat, name, desc, price, available, veg)
            for i, cat, name, desc, price, veg, available, cuisine, popularity in MENU_ITEMS
        ]
        insert_batches(
            conn,
            """INSERT INTO menu_item
               (item_id, category_id, name, description, price, is_available, is_veg)
               VALUES (%s,%s,%s,%s,%s,%s,%s)""",
            menu_rows,
        )
        insert_batches(
            conn,
            """INSERT INTO orders
               (order_id, customer_id, table_id, waiter_id, cashier_id, order_type,
                status, placed_at, prepared_at, closed_at, notes)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            builder.orders, batch_size=1500,
        )
        insert_batches(
            conn,
            """INSERT INTO bill
               (bill_id, order_id, subtotal, tax, discount_amount, grand_total,
                payment_status, generated_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
            builder.bills, batch_size=1500,
        )
        insert_batches(
            conn,
            """INSERT INTO order_item
               (order_id, line_no, item_id, chef_id, quantity, price_at_order, bill_id)
               VALUES (%s,%s,%s,%s,%s,%s,%s)""",
            builder.order_items, batch_size=3000,
        )
        insert_batches(
            conn,
            """INSERT INTO payment
               (payment_id, bill_id, amount, payment_mode, payment_date, payment_status)
               VALUES (%s,%s,%s,%s,%s,%s)""",
            builder.payments, batch_size=2000,
        )

        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE bill b
                LEFT JOIN (
                    SELECT bill_id, SUM(amount) AS paid
                      FROM payment
                     WHERE payment_status = 'SUCCESS'
                     GROUP BY bill_id
                ) p ON p.bill_id = b.bill_id
                SET b.payment_status = CASE
                    WHEN COALESCE(p.paid, 0) >= b.grand_total THEN 'PAID'
                    WHEN COALESCE(p.paid, 0) > 0 THEN 'PARTIAL'
                    ELSE 'UNPAID'
                END
                """
            )
            # Rebuild floor state deterministically from open orders.
            cur.execute("UPDATE dining_table SET status = 'FREE'")
            cur.execute(
                """
                UPDATE dining_table dt
                JOIN orders o ON o.table_id = dt.table_id
                SET dt.status = 'OCCUPIED'
                WHERE o.status IN ('PLACED', 'PREPARING', 'PREPARED', 'BILLED')
                """
            )
            conn.commit()
        with conn.cursor() as cur:
            for table in ["orders", "bill", "order_item", "payment"]:
                cur.execute(f"ANALYZE TABLE {table}")
                cur.fetchall()
        conn.commit()
    finally:
        conn.close()


def load_timescale(events_path: Path):
    result = {}
    conninfo = Config.ts_conninfo()
    t0 = time.time()
    with psycopg.connect(conninfo, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("TRUNCATE TABLE order_event")
            with events_path.open("r", encoding="utf-8", newline="") as f:
                with cur.copy(
                    """
                    COPY order_event (
                        event_time, event_type, order_id, order_type, table_id,
                        customer_id, waiter_id, waiter_name, chef_id, chef_name,
                        item_id, item_name, category_name, quantity, amount,
                        payment_mode, bill_id, payment_id, prep_seconds
                    ) FROM STDIN WITH (FORMAT CSV, HEADER TRUE)
                    """
                ) as copy:
                    while chunk := f.read(1024 * 1024):
                        copy.write(chunk)
            result["load_seconds"] = round(time.time() - t0, 1)

            cur.execute("SELECT min(event_time), max(event_time), count(*) FROM order_event")
            min_ts, max_ts, total = cur.fetchone()
            result["events"] = total
            if total == 0:
                raise RuntimeError("No events were loaded")

            refresh_start = min_ts - timedelta(days=1)
            # Include the current bucket: TRUNCATE leaves old materialized
            # rows behind, so a fresh seed must overwrite them. Stop at the
            # end of the current hour: a future watermark would make the
            # real-time tail hide every later live write until the next
            # refresh, which the projector only does per projected batch.
            refresh_end = max_ts.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
            refresh_seconds = {}
            for cagg in (
                "sales_hourly",
                "order_activity_hourly",
                "payments_hourly",
                "kitchen_performance_hourly",
            ):
                t = time.time()
                cur.execute(
                    f"CALL refresh_continuous_aggregate('{cagg}', %s, %s)",
                    (refresh_start, refresh_end),
                )
                refresh_seconds[cagg] = round(time.time() - t, 1)
            result["cagg_refresh_seconds"] = refresh_seconds

            chunks_compressed = 0
            compression_error = None
            try:
                cur.execute(
                    "SELECT show_chunks('order_event', older_than => now() - interval '14 days')"
                )
                chunks = [row[0] for row in cur.fetchall()]
                result["old_chunks"] = len(chunks)
                for chunk in chunks:
                    cur.execute(
                        "SELECT compress_chunk(%s::regclass, if_not_compressed => true)",
                        (chunk,),
                    )
                    chunks_compressed += 1
            except Exception as exc:
                compression_error = str(exc)
            result["chunks_compressed"] = chunks_compressed
            result["compression_error"] = compression_error

            cur.execute("ANALYZE order_event")
            cur.execute(
                """
                SELECT hypertable_name, num_chunks, compression_enabled
                  FROM timescaledb_information.hypertables
                 WHERE hypertable_name = 'order_event'
                """
            )
            if cur.description:
                result["hypertable"] = cur.fetchone()
            cur.execute("SELECT pg_size_pretty(hypertable_size('order_event'))")
            result["hypertable_size"] = cur.fetchone()[0]
            cur.execute(
                """
                SELECT COUNT(*) FILTER (WHERE is_compressed) AS compressed_chunks,
                       COUNT(*) AS total_chunks
                  FROM timescaledb_information.chunks
                 WHERE hypertable_name = 'order_event'
                """
            )
            result["chunks"] = cur.fetchone()
            cur.execute(
                """
                SELECT event_type, count(*)
                  FROM order_event
                 GROUP BY event_type
                 ORDER BY event_type
                """
            )
            result["event_counts"] = dict(cur.fetchall())
    return result


def mysql_summary():
    conn = mysql_connect()
    try:
        with conn.cursor(dictionary=True) as cur:
            cur.execute(
                """
                SELECT
                    (SELECT COUNT(*) FROM orders) AS orders,
                    (SELECT COUNT(*) FROM order_item) AS order_items,
                    (SELECT COUNT(*) FROM bill) AS bills,
                    (SELECT COUNT(*) FROM payment) AS payments,
                    (SELECT COUNT(*) FROM customer) AS customers,
                    (SELECT COUNT(*) FROM menu_item) AS menu_items,
                    (SELECT COUNT(*) FROM staff) AS staff,
                    (SELECT COUNT(*) FROM dining_table WHERE status='OCCUPIED') AS occupied_tables,
                    (SELECT COUNT(*) FROM orders WHERE status IN ('PLACED','PREPARING','PREPARED','BILLED')) AS live_orders
                """
            )
            summary = cur.fetchone()
            cur.execute(
                """
                SELECT payment_status, COUNT(*) AS n, SUM(grand_total) AS total
                  FROM bill GROUP BY payment_status
                """
            )
            summary["bill_statuses"] = cur.fetchall()
        return summary
    finally:
        conn.close()


def main():
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    SAMPLE_DIR.mkdir(parents=True, exist_ok=True)
    started = time.time()
    now = now_local().replace(microsecond=0)
    customers = build_customers()

    with EVENT_CSV.open("w", newline="", encoding="utf-8") as event_file:
        builder = DatasetBuilder(now, event_file)
        builder.build_history()
        export_samples(builder, customers, builder.event_sample)

    generate_seconds = round(time.time() - started, 1)
    print(f"Generated {len(builder.orders):,} orders, {len(builder.order_items):,} items, "
          f"{builder.event_total:,} events in {generate_seconds}s")
    print(f"Event CSV: {EVENT_CSV} ({EVENT_CSV.stat().st_size / (1024*1024):.1f} MB)")

    t = time.time()
    load_mysql(builder, customers)
    mysql_seconds = round(time.time() - t, 1)
    print(f"MySQL loaded in {mysql_seconds}s")

    t = time.time()
    ts = load_timescale(EVENT_CSV)
    print(f"TimescaleDB loaded in {round(time.time() - t, 1)}s")

    summary = {
        "generated_at": iso_ts(now_local()),
        "seed": SEED,
        "history_days": HISTORY_DAYS,
        "generated_orders": len(builder.orders),
        "generated_order_items": len(builder.order_items),
        "generated_events": builder.event_total,
        "event_counts": builder.event_counts,
        "generate_seconds": generate_seconds,
        "mysql_load_seconds": mysql_seconds,
        "timescale": ts,
        "mysql": mysql_summary(),
        "total_seconds": round(time.time() - started, 1),
    }
    (GENERATED_DIR / "seed_summary.json").write_text(
        json.dumps(summary, indent=2, default=str), encoding="utf-8"
    )
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
