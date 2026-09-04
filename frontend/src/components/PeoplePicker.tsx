/**
 * Pick colleagues by name, from the directory rather than from a list of ids.
 *
 * Shared by every "who should see this" control, so sharing a saved search, a
 * saved view and a dashboard ask the same question the same way. Search runs on
 * the server: the directory is thousands of people, and a picker that filters
 * the first fifty it happened to download is a picker that cannot find anyone
 * whose name starts late in the alphabet.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Avatar, Select, Space, Typography } from "antd";

import { directoryApi, type Person } from "@/api/directory";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

const { Text } = Typography;

export interface PeoplePickerProps {
  /** Selected user ids. */
  value: string[];
  onChange: (ids: string[], people: Person[]) => void;
  /** People already known to the caller, so a stored id still renders a name. */
  known?: Person[];
  multiple?: boolean;
  placeholder?: string;
  disabled?: boolean;
  /** Nobody can be picked twice, and usually the owner cannot be picked at all. */
  exclude?: string[];
  "aria-label"?: string;
  "data-testid"?: string;
}

export function PeoplePicker({
  value,
  onChange,
  known = [],
  multiple = true,
  placeholder = "Search people by name or email…",
  disabled,
  exclude = [],
  ...rest
}: PeoplePickerProps) {
  const [term, setTerm] = useState("");
  const debounced = useDebouncedValue(term, 250);

  const results = useQuery({
    queryKey: ["directory-people", debounced],
    queryFn: ({ signal }) => directoryApi.people(debounced, signal),
    // Names do not change while a drawer is open.
    staleTime: 60_000,
  });

  // The selection has to keep rendering as names once the search term moves on,
  // so anyone already chosen stays in the option list.
  const people = useMemo(() => {
    const byId = new Map<string, Person>();
    for (const person of [...known, ...(results.data?.items ?? [])]) byId.set(person.id, person);
    return [...byId.values()].filter(
      (person) => value.includes(person.id) || !exclude.includes(person.id),
    );
  }, [known, results.data, value, exclude]);

  return (
    <Select
      {...rest}
      mode={multiple ? "multiple" : undefined}
      showSearch
      allowClear
      disabled={disabled}
      loading={results.isFetching}
      placeholder={placeholder}
      value={multiple ? value : value[0]}
      searchValue={term}
      onSearch={setTerm}
      // The server already filtered; filtering again would hide the answer.
      filterOption={false}
      optionLabelProp="label"
      notFoundContent={results.isFetching ? "Searching…" : "Nobody by that name"}
      onChange={(next) => {
        const ids = (Array.isArray(next) ? next : next ? [next] : []) as string[];
        onChange(ids, people.filter((person) => ids.includes(person.id)));
      }}
      options={people.map((person) => ({
        value: person.id,
        label: person.name,
        title: person.email,
        person,
      }))}
      optionRender={({ data }) => {
        const person = (data as { person: Person }).person;
        // Name and role are separate elements, not one text node split by a
        // <br>: a screen reader announces two lines rather than
        // "Mara ManagerMarketing Manager", and the name stays addressable.
        return (
          <Space>
            <Avatar size={22} src={person.avatar_url}>{person.initials}</Avatar>
            <span className="nu-person">
              <span className="nu-person-name">{person.name}</span>
              {person.is_me && <Text type="secondary"> (you)</Text>}
              <Text className="nu-person-role" type="secondary">
                {person.job_title ?? person.email}
              </Text>
            </span>
          </Space>
        );
      }}
    />
  );
}
