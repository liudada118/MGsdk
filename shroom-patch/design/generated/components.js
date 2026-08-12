// 本文件由 npm run generate 从 design-system/components.json 生成，请不要手工编辑。
// 组件清单是唯一真相：改清单后重新生成，MasterGo 属性、shroom/contract 和这里会保持一致。

export const generatedComponents = {
  "Drawer": {
    "import": "@/components/Drawer/Drawer",
    "version": "1.0.0",
    "defaultProps": {
      "title": "",
      "show": false,
      "direction": "right",
      "zindex": 1000,
      "close": true,
      "asideClose": true
    },
    "propsSchema": {
      "title": "string",
      "show": "boolean",
      "direction": {
        "type": "enum",
        "values": [
          "left",
          "right",
          "top",
          "bottom"
        ]
      },
      "zindex": "number",
      "close": "boolean",
      "asideClose": "boolean"
    }
  },
  "IconAndText": {
    "import": "@/components/IconAndText/IconAndText",
    "version": "1.0.0",
    "defaultProps": {
      "text": "",
      "icon": "",
      "disabled": false
    },
    "propsSchema": {
      "text": "string",
      "icon": "string",
      "disabled": "boolean"
    }
  },
  "Select": {
    "import": "@/components/Select/Select",
    "version": "1.0.0",
    "defaultProps": {
      "placeholder": "",
      "disabled": false,
      "options": []
    },
    "propsSchema": {
      "placeholder": "string",
      "disabled": "boolean",
      "options": "array"
    }
  },
}

export default generatedComponents
