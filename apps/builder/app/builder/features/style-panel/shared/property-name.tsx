import { useState, type ReactElement } from "react";
import { useStore } from "@nanostores/react";
import {
  declarationDescriptions,
  propertyDescriptions,
  type Style,
  type StyleProperty,
} from "@webstudio-is/css-data";
import { createCssEngine, toValue } from "@webstudio-is/css-engine";
import {
  theme,
  Button,
  Flex,
  Label,
  Tooltip,
  Text,
  ScrollArea,
} from "@webstudio-is/design-system";
import { ResetIcon } from "@webstudio-is/icons";
import {
  breakpointsStore,
  instancesStore,
  selectedBreakpointStore,
  selectedInstanceStore,
  selectedStyleSourceStore,
  styleSourcesStore,
} from "~/shared/nano-states";
import {
  type StyleInfo,
  getStyleSource,
  type StyleValueInfo,
} from "./style-info";
import { humanizeString } from "~/shared/string-utils";
import { StyleSourceBadge } from "../style-source";
import type {
  Breakpoint,
  Breakpoints,
  StyleSource,
  StyleSources,
} from "@webstudio-is/project-build";

// We don't return source name only in case of preset or default value.
const getSourceName = (
  styleSources: StyleSources,
  styleValueInfo: StyleValueInfo,
  selectedStyleSource?: StyleSource
) => {
  if (styleValueInfo.nextSource) {
    const { styleSourceId } = styleValueInfo.nextSource;
    const styleSource = styleSources.get(styleSourceId);
    if (styleSource?.type === "local") {
      return "Local";
    }
    if (styleSource?.type === "token") {
      return styleSource.name;
    }
  }

  if (styleValueInfo.local) {
    return selectedStyleSource?.type === "token"
      ? selectedStyleSource.name
      : "Local";
  }

  if (styleValueInfo.previousSource) {
    const { styleSourceId } = styleValueInfo.previousSource;
    const styleSource = styleSources.get(styleSourceId);
    if (styleSource?.type === "local") {
      return "Local";
    }
    if (styleSource?.type === "token") {
      return styleSource.name;
    }
  }

  if (styleValueInfo.cascaded) {
    return selectedStyleSource?.type === "token"
      ? selectedStyleSource.name
      : "Local";
  }
};

// @todo consider reusing CssPreview component
const getCssText = (
  properties: readonly StyleProperty[],
  instanceStyle: StyleInfo
) => {
  const cssEngine = createCssEngine();
  const style: Style = {};
  let property: StyleProperty;
  for (property in instanceStyle) {
    const value = instanceStyle[property];
    if (value && properties.includes(property)) {
      style[property] = value.value;
    }
  }
  const rule = cssEngine.addStyleRule("instance", {
    style,
  });
  return rule.styleMap.toString();
};

const getBreakpointName = (
  styleValueInfo: StyleValueInfo,
  breakpoints: Breakpoints,
  selectedBreakpoint?: Breakpoint
) => {
  let breakpoint;
  if (
    styleValueInfo.local ||
    styleValueInfo.previousSource ||
    styleValueInfo.nextSource
  ) {
    breakpoint = selectedBreakpoint;
  } else if (styleValueInfo.cascaded) {
    const { breakpointId } = styleValueInfo.cascaded;
    breakpoint = breakpoints.get(breakpointId);
  }

  return breakpoint?.minWidth ?? breakpoint?.maxWidth ?? "Base";
};

const getDescription = (
  styleValueInfo: StyleValueInfo,
  properties: readonly StyleProperty[]
) => {
  // @todo we don't know how to show a description in this case
  if (properties.length > 1) {
    return;
  }
  // @todo reuse it with CssPreview
  const styleValue =
    styleValueInfo.local ??
    styleValueInfo.nextSource?.value ??
    styleValueInfo.previousSource?.value ??
    styleValueInfo.cascaded?.value ??
    styleValueInfo.preset ??
    styleValueInfo.inherited?.value;

  const property = properties[0];
  const key = `${property}:${toValue(styleValue)}`;
  if (key in declarationDescriptions) {
    return declarationDescriptions[key as keyof typeof declarationDescriptions];
  }
  return propertyDescriptions[property as keyof typeof propertyDescriptions];
};

const TooltipContent = ({
  title,
  properties,
  style,
  onReset,
  onClose,
}: {
  title: string;
  properties: readonly StyleProperty[];
  style: StyleInfo;
  onReset: () => void;
  onClose: () => void;
}) => {
  const breakpoints = useStore(breakpointsStore);
  const selectedBreakpoint = useStore(selectedBreakpointStore);
  const instances = useStore(instancesStore);
  const styleSources = useStore(styleSourcesStore);
  let instance = useStore(selectedInstanceStore);
  const selectedStyleSource = useStore(selectedStyleSourceStore);

  // When we have multiple properties, they must be originating from the same source, so we can just use one.
  const styleValueInfo = style[properties[0]];

  if (styleValueInfo === undefined) {
    return null;
  }

  const description = getDescription(styleValueInfo, properties);

  const styleSource = getStyleSource(styleValueInfo);
  const sourceName = getSourceName(
    styleSources,
    styleValueInfo,
    selectedStyleSource
  );
  const cssText = getCssText(properties, style);
  const breakpointName = getBreakpointName(
    styleValueInfo,
    breakpoints,
    selectedBreakpoint
  );

  if (styleValueInfo.inherited && styleValueInfo.local === undefined) {
    instance = instances.get(styleValueInfo.inherited.instanceId);
  }

  return (
    <Flex direction="column" gap="2" css={{ maxWidth: theme.spacing[28] }}>
      <Text variant="titles">{title}</Text>
      {cssText && (
        <ScrollArea>
          <Text
            variant="monoBold"
            color="moreSubtle"
            css={{
              whiteSpace: "break-spaces",
              maxHeight: "3em",
              userSelect: "text",
              cursor: "text",
            }}
          >
            {cssText}
          </Text>
        </ScrollArea>
      )}
      {description && <Text>{description}</Text>}
      {sourceName && (
        <Flex
          direction="column"
          gap="1"
          css={{ paddingBottom: theme.spacing[5] }}
        >
          <Text color="moreSubtle">Value comes from</Text>
          <Flex gap="1" wrap="wrap">
            <StyleSourceBadge source="breakpoint" variant="small">
              {breakpointName}
            </StyleSourceBadge>
            <StyleSourceBadge source="token" variant="small">
              {sourceName}
            </StyleSourceBadge>
            {instance && (
              <StyleSourceBadge source="instance" variant="small">
                {instance.label || instance.component}
              </StyleSourceBadge>
            )}
          </Flex>
        </Flex>
      )}
      {(styleSource === "local" || styleSource === "overwritten") && (
        <Button
          color="dark"
          prefix={<ResetIcon />}
          css={{ flexGrow: 1 }}
          onMouseDown={(event) => {
            // Prevent closing tooltip
            event.preventDefault();
          }}
          onClickCapture={() => {
            onReset();
            onClose();
          }}
        >
          Reset value
        </Button>
      )}
    </Flex>
  );
};

type PropertyNameProps = {
  style: StyleInfo;
  properties: readonly StyleProperty[];
  label: string | ReactElement;
  title?: string;
  onReset: () => void;
};

export const PropertyName = ({
  style,
  title,
  properties,
  label,
  onReset,
}: PropertyNameProps) => {
  const [isOpen, setIsOpen] = useState(false);
  // When we have multiple properties, they must be originating from the same source, so we can just use one.
  const property = properties[0];

  return (
    <Flex align="center">
      <Tooltip
        open={isOpen}
        onOpenChange={setIsOpen}
        content={
          <TooltipContent
            title={
              title ??
              (typeof label === "string" ? label : humanizeString(property))
            }
            properties={properties}
            style={style}
            onReset={onReset}
            onClose={() => {
              setIsOpen(false);
            }}
          />
        }
      >
        <Flex
          shrink
          gap={1}
          align="center"
          onClick={() => {
            setIsOpen(true);
          }}
        >
          {typeof label === "string" && property ? (
            <Label color={getStyleSource(style[property])} truncate>
              {label}
            </Label>
          ) : (
            label
          )}
        </Flex>
      </Tooltip>
    </Flex>
  );
};
