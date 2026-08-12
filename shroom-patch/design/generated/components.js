// 本文件由 npm run generate 从 design-system/components.json 生成，请不要手工编辑。
// 组件清单是唯一真相：改清单后重新生成，MasterGo 属性、shroom/contract 和这里会保持一致。

export const generatedComponents = {
  "AsyncState": {
    "import": "shroom-backend-sdk/UI/shroomui",
    "version": "1.0.0",
    "defaultProps": {
      "status": "loading",
      "message": "",
      "actionLabel": ""
    },
    "propsSchema": {
      "status": {
        "type": "enum",
        "values": [
          "loading",
          "empty",
          "error"
        ]
      },
      "message": "string",
      "actionLabel": "string"
    }
  },
  "ChartPanel": {
    "import": "shroom-backend-sdk/UI/shroomui",
    "version": "1.0.0",
    "defaultProps": {
      "title": "",
      "description": "",
      "footer": ""
    },
    "propsSchema": {
      "title": "string",
      "description": "string",
      "footer": "string"
    }
  },
  "DraggablePanel": {
    "import": "shroom-backend-sdk/UI/shroomui",
    "version": "1.0.0",
    "defaultProps": {
      "title": ""
    },
    "propsSchema": {
      "title": "string"
    }
  },
  "Drawer": {
    "import": "shroom-backend-sdk/UI/shroomui",
    "version": "1.0.0",
    "defaultProps": {
      "title": "",
      "show": false,
      "direction": "right",
      "asideClose": false,
      "zindex": 1000
    },
    "propsSchema": {
      "title": "string",
      "show": "boolean",
      "direction": {
        "type": "enum",
        "values": [
          "left",
          "right"
        ]
      },
      "asideClose": "boolean",
      "zindex": "number"
    }
  },
  "MetricValue": {
    "import": "shroom-backend-sdk/UI/shroomui",
    "version": "1.0.0",
    "defaultProps": {
      "label": "",
      "value": 0,
      "unit": "",
      "precision": 1,
      "emptyValue": "-",
      "indicatorColor": "",
      "layout": "inline",
      "align": "start"
    },
    "propsSchema": {
      "label": "string",
      "value": "number",
      "unit": "string",
      "precision": "number",
      "emptyValue": "string",
      "indicatorColor": "string",
      "layout": "string",
      "align": "string"
    }
  },
  "Select": {
    "import": "shroom-backend-sdk/UI/shroomui",
    "version": "1.0.0",
    "defaultProps": {
      "defaultValue": "",
      "options": []
    },
    "propsSchema": {
      "defaultValue": "string",
      "options": "array"
    }
  },
  "SettingControlRow": {
    "import": "shroom-backend-sdk/UI/shroomui",
    "version": "1.0.0",
    "defaultProps": {
      "label": "",
      "description": "",
      "meta": "",
      "min": 0,
      "max": 100,
      "step": 1,
      "precision": 0,
      "disabled": false,
      "switchLabel": "",
      "switchChecked": false
    },
    "propsSchema": {
      "label": "string",
      "description": "string",
      "meta": "string",
      "min": "number",
      "max": "number",
      "step": "number",
      "precision": "number",
      "disabled": "boolean",
      "switchLabel": "string",
      "switchChecked": "boolean"
    }
  },
  "ToolbarAction": {
    "import": "shroom-backend-sdk/UI/shroomui",
    "version": "1.0.0",
    "defaultProps": {
      "label": "",
      "title": "",
      "active": false,
      "disabled": false,
      "expanded": true
    },
    "propsSchema": {
      "label": "string",
      "title": "string",
      "active": "boolean",
      "disabled": "boolean",
      "expanded": "boolean"
    }
  },
}

export default generatedComponents
