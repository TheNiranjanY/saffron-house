import { useEffect, useMemo, useState } from "react";
import {
  Eye,
  FolderPlus,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  UtensilsCrossed,
  Utensils,
} from "lucide-react";
import { api, useFetch } from "../lib/api";
import { inr, num } from "../lib/format";
import { cx } from "../lib/utils";
import { useToast } from "../components/Toast";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  SearchInput,
  Segmented,
  Select,
  StatCard,
  Switch,
  Textarea,
} from "../components/UI";

const AVAILABILITY = [
  { value: "all", label: "All" },
  { value: "available", label: "On menu" },
  { value: "hidden", label: "Off menu" },
];

const EMPTY_ITEM = {
  name: "",
  category_id: "",
  price: "",
  description: "",
  is_veg: true,
  is_available: true,
};

export default function MenuManager() {
  const toast = useToast();
  const menu = useFetch("/menu");
  const specials = useFetch("/menu/specials");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [availability, setAvailability] = useState("all");
  const [busyItem, setBusyItem] = useState(null);
  const [itemModal, setItemModal] = useState(null);
  const [itemForm, setItemForm] = useState(EMPTY_ITEM);
  const [savingItem, setSavingItem] = useState(false);
  const [categoryModal, setCategoryModal] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [savingCategory, setSavingCategory] = useState(false);

  const items = menu.data?.items || [];
  const categories = menu.data?.categories || [];
  const available = items.filter((item) => item.is_available);
  const averagePrice = items.length ? items.reduce((total, item) => total + Number(item.price), 0) / items.length : 0;

  useEffect(() => {
    if (!menu.data || itemModal || categoryModal) return;
    if (!itemForm.category_id && categories.length) {
      setItemForm((form) => ({ ...form, category_id: String(categories[0].category_id) }));
    }
  }, [menu.data, categories, itemModal, categoryModal, itemForm.category_id]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      if (category !== "all" && item.category_id !== Number(category)) return false;
      if (availability === "available" && !item.is_available) return false;
      if (availability === "hidden" && item.is_available) return false;
      if (!term) return true;
      return (
        item.name.toLowerCase().includes(term) ||
        item.category_name.toLowerCase().includes(term) ||
        item.description?.toLowerCase().includes(term)
      );
    });
  }, [items, category, availability, search]);

  function openCreate() {
    setItemModal("create");
    setItemForm({
      ...EMPTY_ITEM,
      category_id: categories[0] ? String(categories[0].category_id) : "",
    });
  }

  function openEdit(item) {
    setItemModal(item);
    setItemForm({
      name: item.name,
      category_id: String(item.category_id),
      price: String(item.price),
      description: item.description || "",
      is_veg: item.is_veg,
      is_available: item.is_available,
    });
  }

  async function saveItem(event) {
    event?.preventDefault();
    if (!itemForm.name.trim() || !itemForm.category_id || itemForm.price === "") {
      toast.error("A few details are missing", "Name, category and price are required.");
      return;
    }
    setSavingItem(true);
    try {
      const payload = {
        name: itemForm.name.trim(),
        category_id: Number(itemForm.category_id),
        price: Number(itemForm.price),
        description: itemForm.description.trim() || null,
        is_veg: itemForm.is_veg,
        is_available: itemForm.is_available,
      };
      if (itemModal === "create") {
        const response = await api.post("/menu", payload);
        toast.success("Dish added", `${response.item.name} is now on the menu.`);
      } else {
        const response = await api.patch(`/menu/items/${itemModal.item_id}`, payload);
        toast.success("Dish updated", `${response.item.name} was saved.`);
      }
      setItemModal(null);
      menu.refresh();
    } catch (error) {
      toast.error("The dish could not be saved", error.message);
    } finally {
      setSavingItem(false);
    }
  }

  async function toggleAvailability(item) {
    setBusyItem(item.item_id);
    try {
      await api.patch(`/menu/items/${item.item_id}`, { is_available: !item.is_available });
      toast.success(
        item.is_available ? `${item.name} hidden` : `${item.name} is back`,
        item.is_available ? "Guests will no longer see it in the POS." : "It is available to order again."
      );
      menu.refresh();
    } catch (error) {
      toast.error("Availability could not be changed", error.message);
    } finally {
      setBusyItem(null);
    }
  }

  async function createCategory(event) {
    event?.preventDefault();
    if (!categoryName.trim()) return;
    setSavingCategory(true);
    try {
      const response = await api.post("/menu/categories", { category_name: categoryName.trim() });
      toast.success("Category created", `${response.category.category_name} is ready for dishes.`);
      setCategoryModal(false);
      setCategoryName("");
      menu.refresh();
    } catch (error) {
      toast.error("Category could not be created", error.message);
    } finally {
      setSavingCategory(false);
    }
  }

  const availabilityPct = items.length ? Math.round((available.length / items.length) * 100) : 0;

  return (
    <div className="page menu-admin">
      <PageHeader
        eyebrow="Kitchen catalogue"
        title="The menu, edited live."
        description="Prices and availability are operational data: changes land in MySQL and immediately shape what the POS can sell."
        actions={
          <>
            <button
              type="button"
              className="icon-btn"
              onClick={() => { menu.refresh(); specials.refresh(); }}
              title="Refresh menu"
            >
              <RefreshCw size={15} className={menu.loading && menu.data ? "spin" : ""} />
            </button>
            <Button variant="outline" icon={FolderPlus} onClick={() => setCategoryModal(true)}>New category</Button>
            <Button icon={Plus} onClick={openCreate} disabled={!categories.length}>Add dish</Button>
          </>
        }
      />

      {menu.error && !menu.data ? (
        <ErrorState error={menu.error} onRetry={menu.refresh} title="The menu could not be loaded" />
      ) : !menu.data ? (
        <Card><Loading label="Reading the menu catalogue" rows={5} /></Card>
      ) : (
        <>
          <div className="kpi-grid menu-kpis">
            <StatCard label="Dishes on the menu" value={num(available.length)} icon={Utensils} tone="saffron" sub={`${items.length - available.length} currently hidden`} />
            <StatCard label="Categories" value={num(categories.length)} icon={FolderPlus} tone="violet" sub="editorial groupings" />
            <StatCard label="Average price" value={inr(averagePrice)} icon={UtensilsCrossed} tone="green" sub="across all dishes" />
            <StatCard label="Menu readiness" value={`${availabilityPct}%`} icon={Eye} tone="teal" sub={`${available.length} of ${items.length} sellable`} />
          </div>

          <div className="menu-layout">
            <Card className="table-card menu-table-card">
              <div className="menu-toolbar">
                <div className="category-chips">
                  <button
                    type="button"
                    className={cx("category-chip", category === "all" && "is-active")}
                    onClick={() => setCategory("all")}
                  >
                    All <span>{items.length}</span>
                  </button>
                  {categories.map((item) => (
                    <button
                      key={item.category_id}
                      type="button"
                      className={cx("category-chip", category === String(item.category_id) && "is-active")}
                      onClick={() => setCategory(String(item.category_id))}
                    >
                      {item.category_name} <span>{item.item_count}</span>
                    </button>
                  ))}
                </div>
                <div className="menu-toolbar__filters">
                  <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search dishes" />
                  <Segmented options={AVAILABILITY} value={availability} onChange={setAvailability} size="sm" />
                </div>
              </div>

              {filtered.length === 0 ? (
                <div className="table-empty">
                  <EmptyState
                    icon={UtensilsCrossed}
                    title="No dishes in this view"
                    description="Try another category, availability state or search term."
                    action={
                      <Button
                        variant="outline"
                        onClick={() => { setSearch(""); setCategory("all"); setAvailability("all"); }}
                      >
                        Reset filters
                      </Button>
                    }
                  />
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table menu-table">
                    <thead>
                      <tr>
                        <th>Dish</th>
                        <th>Category</th>
                        <th className="num">Price</th>
                        <th>On menu</th>
                        <th aria-label="Edit" />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((item) => (
                        <tr key={item.item_id} className={cx(!item.is_available && "is-hidden-item")}>
                          <td>
                            <div className="dish-cell">
                              <span className={cx("veg-mark", !item.is_veg && "veg-mark--nonveg")} />
                              <div>
                                <span className="strong">{item.name}</span>
                                <span className="sub">{item.description || "No description"}</span>
                              </div>
                            </div>
                          </td>
                          <td><Badge tone="neutral">{item.category_name}</Badge></td>
                          <td className="num strong">{inr(item.price)}</td>
                          <td>
                            <div className="availability-cell">
                              <Switch
                                checked={item.is_available}
                                disabled={busyItem === item.item_id}
                                onChange={() => toggleAvailability(item)}
                                label={item.is_available ? "Available" : "Hidden"}
                              />
                            </div>
                          </td>
                          <td className="actions">
                            <button type="button" className="icon-btn" onClick={() => openEdit(item)} aria-label={`Edit ${item.name}`} title="Edit dish">
                              <Pencil size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <aside className="menu-side">
              <Card className="menu-health">
                <CardHeader title="Menu health" subtitle="What guests can order right now" icon={Eye} />
                <div className="availability-ring-wrap">
                  <div
                    className="availability-ring"
                    style={{
                      background: `conic-gradient(#5f8a67 ${availabilityPct * 3.6}deg, #eee2d0 0deg)`,
                    }}
                  >
                    <div>
                      <strong>{availabilityPct}%</strong>
                      <span>sellable</span>
                    </div>
                  </div>
                </div>
                <div className="menu-health__counts">
                  <div><span className="dot dot--green" /> {available.length} on the menu</div>
                  <div><span className="dot dot--amber" /> {items.length - available.length} hidden</div>
                </div>
                <div className="category-breakdown">
                  {categories.map((cat) => (
                    <div key={cat.category_id}>
                      <div>
                        <span>{cat.category_name}</span>
                        <strong>{cat.available_count}/{cat.item_count}</strong>
                      </div>
                      <div className="mini-bar">
                        <span
                          className="mini-bar__fill mini-bar__fill--green"
                          style={{ width: `${cat.item_count ? (cat.available_count / cat.item_count) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card>
                <CardHeader title="Guest favourites" subtitle="All-time units sold" icon={Sparkles} />
                {specials.loading && !specials.data ? (
                  <Loading label="Reading favourites" rows={3} />
                ) : (
                  <ol className="specials-list">
                    {(specials.data?.items || []).slice(0, 6).map((item, index) => (
                      <li key={item.item_id}>
                        <span className={cx("specials-list__rank", index === 0 && "is-first")}>{index + 1}</span>
                        <div>
                          <span>{item.name}</span>
                          <small>{item.category_name}</small>
                        </div>
                        <strong>{num(item.units_sold)}</strong>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            </aside>
          </div>
        </>
      )}

      <Modal
        open={Boolean(itemModal)}
        onClose={() => !savingItem && setItemModal(null)}
        title={itemModal === "create" ? "Add a dish" : "Edit dish"}
        description={itemModal === "create" ? "New dishes become sellable in the POS as soon as they are saved." : "Changes apply to future orders; historic line prices stay frozen."}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setItemModal(null)} disabled={savingItem}>Cancel</Button>
            <Button icon={itemModal === "create" ? Plus : Pencil} onClick={saveItem} loading={savingItem}>
              {itemModal === "create" ? "Add dish" : "Save changes"}
            </Button>
          </>
        }
      >
        <form className="form-stack" onSubmit={saveItem}>
          <div className="form-grid">
            <Field label="Dish name" htmlFor="dish-name">
              <Input
                id="dish-name"
                value={itemForm.name}
                onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })}
                placeholder="e.g. Saffron Prawn Curry"
                maxLength={80}
                autoFocus
              />
            </Field>
            <Field label="Category" htmlFor="dish-category">
              <Select
                id="dish-category"
                value={itemForm.category_id}
                onChange={(event) => setItemForm({ ...itemForm, category_id: event.target.value })}
              >
                <option value="">Select category</option>
                {categories.map((cat) => (
                  <option key={cat.category_id} value={cat.category_id}>{cat.category_name}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Price (₹)" htmlFor="dish-price">
              <Input
                id="dish-price"
                type="number"
                min="0"
                step="1"
                value={itemForm.price}
                onChange={(event) => setItemForm({ ...itemForm, price: event.target.value })}
                placeholder="450"
              />
            </Field>
            <Field label="Dietary">
              <div className="dietary-toggle">
                <button
                  type="button"
                  className={cx("diet-pill", itemForm.is_veg && "is-active")}
                  onClick={() => setItemForm({ ...itemForm, is_veg: true })}
                >
                  <span className="veg-mark" /> Vegetarian
                </button>
                <button
                  type="button"
                  className={cx("diet-pill", !itemForm.is_veg && "is-active")}
                  onClick={() => setItemForm({ ...itemForm, is_veg: false })}
                >
                  <span className="veg-mark veg-mark--nonveg" /> Non-veg
                </button>
              </div>
            </Field>
          </div>
          <Field label="Description" htmlFor="dish-description" hint="Shown in the POS to help waiters describe the dish.">
            <Textarea
              id="dish-description"
              value={itemForm.description}
              onChange={(event) => setItemForm({ ...itemForm, description: event.target.value })}
              placeholder="Clay oven, cultured butter, house spice blend…"
              rows={3}
            />
          </Field>
          <div className="dish-availability">
            <Switch
              checked={itemForm.is_available}
              onChange={(event) => setItemForm({ ...itemForm, is_available: event.target.checked })}
              label="Available to order"
            />
            <span className="field__hint">Turn off for sold-out dishes or seasonal pauses.</span>
          </div>
          <button type="submit" className="sr-only">Save dish</button>
        </form>
      </Modal>

      <Modal
        open={categoryModal}
        onClose={() => !savingCategory && setCategoryModal(false)}
        title="New menu category"
        description="Categories group dishes in both the POS and the analytics menu breakdown."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCategoryModal(false)} disabled={savingCategory}>Cancel</Button>
            <Button icon={FolderPlus} onClick={createCategory} loading={savingCategory} disabled={!categoryName.trim()}>Create</Button>
          </>
        }
      >
        <form onSubmit={createCategory}>
          <Field label="Category name" htmlFor="category-name">
            <Input
              id="category-name"
              value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)}
              placeholder="e.g. Saffron specials"
              maxLength={80}
              autoFocus
            />
          </Field>
          <button type="submit" className="sr-only">Create category</button>
        </form>
      </Modal>
    </div>
  );
}
