// src/lib/userRoleFetch.ts
export type UserRole = { number: number; name: string };

export async function fetchUserRoles(): Promise<UserRole[]> {
    const res = await fetch("/api/user-role", { cache: "no-store" });
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    if (!json.roles || !Array.isArray(json.roles)) {
        return [];
    }
    return json.roles.map((r: unknown) => {
        if (typeof r === "object" && r !== null && "number" in r && "name" in r) {
            const { number, name } = r as { number: number; name: string };
            return { number, name };
        }
        return { number: 0, name: "" };
    });
}
